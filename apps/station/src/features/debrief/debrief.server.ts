import type { ServerMsg } from "@mothership/protocol";
import type { ProviderAdapter } from "@mothership/providers";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../shared/db/client.server";
import { briefs, inspections, lessons, preflightResults, preflights } from "../../shared/db/schema";
import { goalOf } from "../briefs/model";
import type { MissionEnd } from "../crew/service.server";
import { getDeck } from "../decks/decks.server";
import { parseFindings } from "../inspection/model";
import { REVIEW_TIMEOUT_MS, runReview, type RunReview } from "../inspection/runner.server";
import type { ReviewSlot } from "../inspection/slot.server";
import { missionId } from "../log/model";
import type { CheckService } from "../preflight/checks.server";
import type { RankService } from "../ranks/ranks.server";
import { evidenceSummary, missionHadTrouble, type MissionEvidence } from "./evidence";
import { MAX_KEPT_LESSONS, PENDING_DAYS, type LessonState } from "./model";
import { debriefPrompt, parseDebrief } from "./prompt";

/** One lesson as stored. */
export interface Lesson {
  id: string;
  deckId: string;
  text: string;
  state: LessonState;
  fromName: string;
  evidence: string;
  createdAt: number;
  settledAt?: number;
}

export type LessonResult = { ok: true } | { ok: false; message: string };

/** What the debrief needs; `run` and `repoPath` are swapped in tests. */
export interface DebriefDeps {
  db: Db;
  ranks: Pick<RankService, "lessonKept">;
  /** For the deck's `deck.checks` message, which carries its pending count. */
  checks: Pick<CheckService, "message">;
  /** Adapters by crew row `provider`; one without `reviewPlan` (a shell) gets no debrief. */
  providers: Record<string, ProviderAdapter>;
  /** The station's review slots, shared with the Inspector. */
  slot: ReviewSlot;
  broadcast: (msg: ServerMsg) => void;
  run?: RunReview;
  /** Where a deck's debrief runs: its checkout, which outlives any crew worktree. */
  repoPath?: (deckId: string) => string;
}

type Row = typeof lessons.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The debrief: when a mission that hit trouble ends, a read-only `claude -p` drafts up to two
 * lessons from what went wrong. You keep or drop each; kept ones go to every new crew launch on
 * the deck (at most MAX_KEPT_LESSONS) until retired.
 */
export class DebriefService {
  readonly #db: Db;
  readonly #ranks: DebriefDeps["ranks"];
  readonly #checks: DebriefDeps["checks"];
  readonly #providers: Record<string, ProviderAdapter>;
  readonly #slot: ReviewSlot;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #run: RunReview;
  readonly #repoPath: (deckId: string) => string;
  /** Missions already debriefed, by crew member and mission start: one debrief each. */
  readonly #debriefed = new Set<string>();

  constructor(deps: DebriefDeps) {
    this.#db = deps.db;
    this.#ranks = deps.ranks;
    this.#checks = deps.checks;
    this.#providers = deps.providers;
    this.#slot = deps.slot;
    this.#broadcast = deps.broadcast;
    this.#run = deps.run ?? runReview;
    this.#repoPath = deps.repoPath ?? ((deckId) => getDeck(this.#db, deckId).repoPath);
  }

  /**
   * A mission ended: gather what went wrong now (X deletes the rows' crew member right after) and,
   * if anything did, draft lessons in the background.
   */
  onMissionEnd(end: MissionEnd): void {
    if (!end.ownWorktree) return;
    const adapter = this.#providers[end.provider];
    if (!adapter?.reviewPlan) return;
    const key = `${end.crewId}:${end.missionSince}`;
    if (this.#debriefed.has(key)) return;
    const evidence = this.#evidence(end);
    if (!missionHadTrouble(evidence)) return;
    this.#debriefed.add(key);
    void this.#draft(end, adapter, evidence).catch((error: unknown) => {
      console.error(`[debrief] failed for ${end.name}`, error);
      this.#failed(end, (error as Error).message);
    });
  }

  /** The deck's pending lessons from the last week and its kept ones, oldest first. */
  list(deckId: string): { pending: Lesson[]; kept: Lesson[] } {
    return {
      pending: this.#rows(deckId, "pending", Date.now() - PENDING_DAYS * DAY_MS).map(toLesson),
      kept: this.#rows(deckId, "kept").map(toLesson),
    };
  }

  /** The kept lessons' text, oldest first, for new crew launches. */
  kept(deckId: string): string[] {
    return this.#rows(deckId, "kept").map((r) => r.text);
  }

  /** How many lessons wait for review (the ones `list` shows). */
  pendingCount(deckId: string): number {
    return this.list(deckId).pending.length;
  }

  /** Keep a pending lesson (Y), crediting the call sign it came from; at most 12 are kept. */
  keep(lessonId: string): LessonResult {
    const row = this.#row(lessonId);
    if (!row) return { ok: false, message: "No such lesson" };
    if (row.state !== "pending") return { ok: false, message: `Already ${row.state}` };
    if (this.kept(row.deckId).length >= MAX_KEPT_LESSONS) {
      return { ok: false, message: `Retire a lesson first (${MAX_KEPT_LESSONS} kept)` };
    }
    const result = this.#move(row, "pending", "kept");
    if (result.ok) this.#ranks.lessonKept(row.deckId, row.fromName);
    return result;
  }

  /** Drop a pending lesson (N). */
  drop(lessonId: string): LessonResult {
    const row = this.#row(lessonId);
    if (!row) return { ok: false, message: "No such lesson" };
    return this.#move(row, "pending", "dropped");
  }

  /** Retire a kept lesson (R): new crew aren't told it any more. */
  retire(lessonId: string): LessonResult {
    const row = this.#row(lessonId);
    if (!row) return { ok: false, message: "No such lesson" };
    return this.#move(row, "kept", "retired");
  }

  async #draft(end: MissionEnd, adapter: ProviderAdapter, evidence: MissionEvidence) {
    const plan = adapter.reviewPlan!({ cwd: this.#repoPath(end.deckId) });
    const release = await this.#slot.acquire();
    if (!release) return;
    // Read after the wait: lessons kept meanwhile aren't drafted again.
    const kept = this.kept(end.deckId);
    let review;
    try {
      review = await this.#run({
        plan,
        prompt: debriefPrompt(evidence, kept),
        timeoutMs: REVIEW_TIMEOUT_MS,
      });
    } finally {
      release();
    }
    if (!review.ok) {
      this.#failed(end, review.error ?? `Exited with code ${review.exitCode}`);
      return;
    }
    const parsed = parseDebrief(review.stdout, kept);
    if ("failed" in parsed) {
      this.#failed(end, parsed.failed);
      return;
    }
    // Nothing worth keeping is a normal answer: no lessons, no toast.
    if (parsed.lessons.length === 0) return;
    const summary = evidenceSummary(evidence);
    const now = Date.now();
    this.#db
      .insert(lessons)
      .values(
        parsed.lessons.map((text) => ({
          id: crypto.randomUUID(),
          deckId: end.deckId,
          text,
          fromName: end.name,
          evidence: summary,
          missionId: missionId(end.crewId, end.missionSince),
          createdAt: now,
        })),
      )
      .run();
    this.#changed(end.deckId);
    this.#broadcast({
      type: "deck.debrief",
      deckId: end.deckId,
      name: end.name,
      drafted: parsed.lessons.length,
    });
  }

  #failed(end: MissionEnd, failed: string): void {
    this.#broadcast({
      type: "deck.debrief",
      deckId: end.deckId,
      name: end.name,
      drafted: 0,
      failed,
    });
  }

  /** What went wrong on the mission: its NO-GO stop runs, flagged inspections and revised briefs. */
  #evidence(end: MissionEnd): MissionEvidence {
    const runs = this.#db
      .select({ id: preflights.id })
      .from(preflights)
      .where(
        and(
          eq(preflights.crewId, end.crewId),
          eq(preflights.trigger, "stop"),
          eq(preflights.state, "nogo"),
          gte(preflights.startedAt, end.missionSince),
        ),
      )
      .orderBy(asc(preflights.startedAt))
      .all();
    const failing = runs.length
      ? this.#db
          .select()
          .from(preflightResults)
          .where(
            and(
              inArray(
                preflightResults.preflightId,
                runs.map((r) => r.id),
              ),
              eq(preflightResults.verdict, "nogo"),
            ),
          )
          .orderBy(asc(preflightResults.position))
          .all()
      : [];
    const nogo = runs.map((run) => {
      const results = failing.filter((r) => r.preflightId === run.id);
      return { checks: results.map((r) => r.name), tails: results.map((r) => r.tail) };
    });

    const flagged = this.#db
      .select({ findings: inspections.findings })
      .from(inspections)
      .where(
        and(
          eq(inspections.crewId, end.crewId),
          eq(inspections.state, "flagged"),
          gte(inspections.startedAt, end.missionSince),
        ),
      )
      .orderBy(asc(inspections.startedAt))
      .all()
      .flatMap((r) => parseFindings(r.findings))
      .filter((f) => f.severity === "blocker")
      .map((f) => ({ title: f.title, ...(f.file && { file: f.file }), why: f.why }));

    const revised = this.#db
      .select({ text: briefs.text, reason: briefs.reason })
      .from(briefs)
      .where(
        and(
          eq(briefs.crewId, end.crewId),
          eq(briefs.state, "revised"),
          gte(briefs.createdAt, end.missionSince),
        ),
      )
      .orderBy(asc(briefs.revision))
      .all()
      .map((b) => ({ goal: goalOf(b.text), reason: b.reason ?? "" }));

    return { task: end.task.split("\n")[0] ?? "", nogo, flagged, revised };
  }

  /** Move a lesson from one state to another; "Already <state>" when it isn't in `from` any more. */
  #move(row: Row, from: LessonState, to: LessonState): LessonResult {
    const { changes } = this.#db
      .update(lessons)
      .set({ state: to, settledAt: Date.now() })
      .where(and(eq(lessons.id, row.id), eq(lessons.state, from)))
      .run();
    if (changes === 0) {
      const now = this.#row(row.id);
      return { ok: false, message: `Already ${now?.state ?? row.state}` };
    }
    this.#changed(row.deckId);
    return { ok: true };
  }

  /** The deck's lessons changed: refresh its list and its pending count. */
  #changed(deckId: string): void {
    this.#broadcast({ type: "deck.lessons", deckId });
    this.#broadcast(this.#checks.message(deckId));
  }

  #rows(deckId: string, state: LessonState, since?: number): Row[] {
    return this.#db
      .select()
      .from(lessons)
      .where(
        and(
          eq(lessons.deckId, deckId),
          eq(lessons.state, state),
          since === undefined ? undefined : gte(lessons.createdAt, since),
        ),
      )
      .orderBy(asc(lessons.createdAt), asc(sql`rowid`))
      .all();
  }

  #row(lessonId: string): Row | undefined {
    return this.#db.select().from(lessons).where(eq(lessons.id, lessonId)).get();
  }
}

function toLesson(row: Row): Lesson {
  return {
    id: row.id,
    deckId: row.deckId,
    text: row.text,
    state: row.state,
    fromName: row.fromName,
    evidence: row.evidence,
    createdAt: row.createdAt,
    ...(row.settledAt !== null && { settledAt: row.settledAt }),
  };
}
