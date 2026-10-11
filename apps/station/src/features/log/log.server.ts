import type { RankInfo, ServerMsg } from "@mothership/protocol";
import { and, asc, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { Db } from "../../shared/db/client.server";
import {
  briefs,
  inspections,
  lessons,
  missionPrs,
  missions,
  preflightResults,
  preflights,
  serviceRecords,
} from "../../shared/db/schema";
import type { MissionEnd } from "../crew/service.server";
import { parseFindings, type Finding } from "../inspection/model";
import { pointsOf, rankOf } from "../ranks/model";
import { missionId, missionVerdict, type Outcome, type VerdictKind } from "./model";

/** How many missions the log lists at a time. */
export const LOG_PAGE = 30;

/** The most of a task's first line the log keeps. */
const TASK_CHARS = 200;

/** One mission in the log's list. */
export interface MissionSummary {
  id: string;
  name: string;
  /** The call sign's rank on the deck now. */
  rank?: RankInfo;
  task: string;
  endedAt: number;
  how: "pr" | "home";
  prUrl?: string;
  verdict: { kind: VerdictKind; line: string };
}

/** A mission with its evidence; pre-flight output is fetched apart (`runOutput`). */
export type MissionEntry = MissionSummary & {
  startedAt: number;
  branch?: string;
  briefs: { revision: number; state: string; text: string; reason?: string }[];
  preflights: {
    id: string;
    attempt: number;
    trigger: string;
    state: string;
    commit?: string;
    durationMs?: number;
    /** Names of the checks that failed. */
    failed: string[];
  }[];
  inspections: {
    id: string;
    attempt: number;
    trigger: string;
    state: string;
    reason?: string;
    /** Blockers first. */
    findings: Finding[];
  }[];
  /** Stop runs that handed work back: NO-GO pre-flights and flagged inspections. */
  handBacks: number;
  outcome: Outcome;
  lessons: { id: string; text: string; state: string }[];
};

type Row = typeof missions.$inferSelect;

interface Deps {
  db: Db;
  broadcast: (msg: ServerMsg) => void;
}

/**
 * The captain's log: one read-only entry per ended mission, its evidence read from the crew
 * member's rows inside the mission's window, which outlive the crew member.
 */
export class MissionLog {
  readonly #db: Db;
  readonly #broadcast: (msg: ServerMsg) => void;

  constructor(deps: Deps) {
    this.#db = deps.db;
    this.#broadcast = deps.broadcast;
  }

  /** A mission ended: log it once. Sent home having done nothing since the last one isn't logged. */
  onMissionEnd(end: MissionEnd): void {
    if (end.provider === "shell" || !end.ownWorktree) return;
    if (end.how === "home" && !this.#hadWork(end)) return;
    const { changes } = this.#db
      .insert(missions)
      .values({
        id: missionId(end.crewId, end.missionSince),
        deckId: end.deckId,
        crewId: end.crewId,
        name: end.name,
        task: (end.task.split("\n")[0] ?? "").slice(0, TASK_CHARS),
        startedAt: end.missionSince,
        endedAt: end.endedAt,
        how: end.how,
        prUrl: end.prUrl ?? null,
        branch: end.branch ?? null,
      })
      .onConflictDoNothing()
      .run();
    if (changes > 0) this.#broadcast({ type: "deck.log", deckId: end.deckId });
  }

  /** The deck's missions, newest first; `before` pages past the last one listed. */
  list(
    deckId: string,
    opts: { before?: { endedAt: number; id: string }; limit?: number } = {},
  ): MissionSummary[] {
    const { before, limit = LOG_PAGE } = opts;
    const rows = this.#db
      .select()
      .from(missions)
      .where(
        and(
          eq(missions.deckId, deckId),
          before &&
            or(
              lt(missions.endedAt, before.endedAt),
              and(eq(missions.endedAt, before.endedAt), lt(missions.id, before.id)),
            ),
        ),
      )
      .orderBy(desc(missions.endedAt), desc(missions.id))
      .limit(limit)
      .all();
    const ranks = this.#ranks(
      deckId,
      rows.map((r) => r.name),
    );
    return rows.map((row): MissionSummary => {
      const { summary } = this.#read(row);
      return { ...summary, rank: ranks.get(row.name) ?? rankOf(0) };
    });
  }

  /** One mission with its evidence, or null when there's no such mission. */
  entry(id: string): MissionEntry | null {
    const row = this.#db.select().from(missions).where(eq(missions.id, id)).get();
    if (!row) return null;
    const { summary, outcome, runs, reviews, revisions } = this.#read(row);
    const failing = runs.length
      ? this.#db
          .select({ preflightId: preflightResults.preflightId, name: preflightResults.name })
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
    const kept = this.#db
      .select({ id: lessons.id, text: lessons.text, state: lessons.state })
      .from(lessons)
      .where(eq(lessons.missionId, row.id))
      .orderBy(asc(lessons.createdAt))
      .all();
    return {
      ...summary,
      startedAt: row.startedAt,
      ...(row.branch !== null && { branch: row.branch }),
      briefs: revisions.map((b) => ({
        revision: b.revision,
        state: b.state,
        text: b.text,
        ...(b.reason !== null && { reason: b.reason }),
      })),
      preflights: runs.map((r) => ({
        id: r.id,
        attempt: r.attempt,
        trigger: r.trigger,
        state: r.state,
        ...(r.commit && { commit: r.commit }),
        ...(r.finishedAt !== null && { durationMs: r.finishedAt - r.startedAt }),
        failed: failing.filter((f) => f.preflightId === r.id).map((f) => f.name),
      })),
      inspections: reviews.map((i) => {
        const findings = parseFindings(i.findings);
        return {
          id: i.id,
          attempt: i.attempt,
          trigger: i.trigger,
          state: i.state,
          ...(i.reason !== null && { reason: i.reason }),
          findings: [
            ...findings.filter((f) => f.severity === "blocker"),
            ...findings.filter((f) => f.severity !== "blocker"),
          ],
        };
      }),
      handBacks:
        runs.filter((r) => r.trigger === "stop" && r.state === "nogo").length +
        reviews.filter((i) => i.trigger === "stop" && i.state === "flagged").length,
      outcome,
      lessons: kept,
    };
  }

  /** A pre-flight's failing checks with their output, as stored. */
  runOutput(preflightId: string): { name: string; tail: string }[] {
    return this.#db
      .select({ name: preflightResults.name, tail: preflightResults.tail })
      .from(preflightResults)
      .where(
        and(eq(preflightResults.preflightId, preflightId), eq(preflightResults.verdict, "nogo")),
      )
      .orderBy(asc(preflightResults.position))
      .all();
  }

  /** The mission's rows, its outcome and its summary with the verdict. */
  #read(row: Row) {
    const runs = this.#db
      .select()
      .from(preflights)
      .where(and(eq(preflights.crewId, row.crewId), this.#within(preflights.startedAt, row)))
      .orderBy(asc(preflights.startedAt))
      .all();
    const reviews = this.#db
      .select()
      .from(inspections)
      .where(and(eq(inspections.crewId, row.crewId), this.#within(inspections.startedAt, row)))
      .orderBy(asc(inspections.startedAt))
      .all();
    const revisions = this.#db
      .select()
      .from(briefs)
      .where(and(eq(briefs.crewId, row.crewId), this.#within(briefs.createdAt, row)))
      .orderBy(asc(briefs.revision))
      .all();
    const outcome = this.#outcome(row);
    // First tries as ranks count them: the first stop run that wasn't cancelled.
    const firstRun = runs.find((r) => r.trigger === "stop" && r.state !== "cancelled");
    const firstReview = reviews.find((i) => i.trigger === "stop" && i.state !== "cancelled");
    const verdict = missionVerdict({
      outcome,
      briefRevisions: revisions.length,
      nogos: runs.filter((r) => r.trigger === "stop" && r.state === "nogo").length,
      flags: reviews.filter((i) => i.trigger === "stop" && i.state === "flagged").length,
      firstGo: firstRun ? firstRun.state === "go" : null,
      firstClear: firstReview ? firstReview.state === "cleared" : null,
    });
    const summary: MissionSummary = {
      id: row.id,
      name: row.name,
      task: row.task,
      endedAt: row.endedAt,
      how: row.how,
      ...(row.prUrl !== null && { prUrl: row.prUrl }),
      verdict,
    };
    return { summary, outcome, runs, reviews, revisions };
  }

  /**
   * A row is the mission's from its start up to its end. A pull request's end is where the next
   * mission starts, so it isn't this one's; nothing follows a send-home, so its end is.
   */
  #within(column: SQLiteColumn, m: Pick<Row, "startedAt" | "endedAt" | "how">) {
    return and(
      gte(column, m.startedAt),
      m.how === "pr" ? lt(column, m.endedAt) : lte(column, m.endedAt),
    );
  }

  /** Whether a send-home's mission did anything: a brief, a pre-flight or an inspection. */
  #hadWork(end: MissionEnd): boolean {
    const window = { startedAt: end.missionSince, endedAt: end.endedAt, how: end.how };
    return (
      !!this.#db
        .select({ id: briefs.id })
        .from(briefs)
        .where(and(eq(briefs.crewId, end.crewId), this.#within(briefs.createdAt, window)))
        .get() ||
      !!this.#db
        .select({ id: preflights.id })
        .from(preflights)
        .where(and(eq(preflights.crewId, end.crewId), this.#within(preflights.startedAt, window)))
        .get() ||
      !!this.#db
        .select({ id: inspections.id })
        .from(inspections)
        .where(and(eq(inspections.crewId, end.crewId), this.#within(inspections.startedAt, window)))
        .get()
    );
  }

  #outcome(row: Row): Outcome {
    if (row.how === "home" || row.prUrl === null) return "home";
    const pull = this.#db
      .select({ mergedAt: missionPrs.mergedAt, closedAt: missionPrs.closedAt })
      .from(missionPrs)
      .where(eq(missionPrs.url, row.prUrl))
      .get();
    if (pull?.mergedAt != null) return "merged";
    if (pull?.closedAt != null) return "closed";
    return "open";
  }

  /** Each call sign's rank on the deck now, from its service record. */
  #ranks(deckId: string, names: string[]): Map<string, RankInfo> {
    if (names.length === 0) return new Map();
    const records = this.#db
      .select()
      .from(serviceRecords)
      .where(
        and(eq(serviceRecords.deckId, deckId), inArray(serviceRecords.name, [...new Set(names)])),
      )
      .all();
    return new Map(records.map((r) => [r.name, rankOf(pointsOf(r))]));
  }
}
