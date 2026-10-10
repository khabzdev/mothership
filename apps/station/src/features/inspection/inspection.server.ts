import type { InspectionInfo, InspectionState, ServerMsg } from "@mothership/protocol";
import type { LaunchPlan, ProviderAdapter } from "@mothership/providers";
import { and, desc, eq, notInArray, sql, type SQL } from "drizzle-orm";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { Db } from "../../shared/db/client.server";
import { crew as crewTable, decks, inspections } from "../../shared/db/schema";
import type { BriefService } from "../briefs/briefs.server";
import type { CrewSignalEvent } from "../crew/hooks.server";
import type { CrewService } from "../crew/service.server";
import type { CheckService } from "../preflight/checks.server";
import { fingerprint as worktreeFingerprint } from "../preflight/fingerprint.server";
import { afterVerdict } from "../preflight/flight";
import type { PreflightService } from "../preflight/preflight.server";
import { readInspectionDiff } from "./diff.server";
import { flaggedDetail, inspectionHandBack, type Finding } from "./model";
import { parseReview, reviewPrompt } from "./review";
import { REVIEW_TIMEOUT_MS, runReview, type RunReview } from "./runner.server";
import { scopeCheck, type ChangedStat } from "./scope";

const exec = promisify(execFile);

/** At most this many AI reviews run at once, station-wide; the rest wait their turn. */
export const MAX_REVIEWS = 1;

export type InspectionTrigger = "stop" | "manual";

export interface InspectionRecord {
  id: string;
  crewId: string;
  deckId: string;
  flight: number;
  attempt: number;
  trigger: InspectionTrigger;
  state: InspectionState;
  reason?: string;
  fingerprint: string;
  commit: string;
  findings: Finding[];
  briefId?: string;
  startedAt: number;
  finishedAt?: number;
}

type Print = { hash: string; commit: string };

export interface InspectionDeps {
  db: Db;
  crew: CrewService;
  checks: CheckService;
  briefs: Pick<BriefService, "approvedForTask" | "planning">;
  preflight: Pick<PreflightService, "latest">;
  /** Adapters by crew row `provider`; one without `reviewPlan` (a shell) is never inspected. */
  providers: Record<string, ProviderAdapter>;
  broadcast: (msg: ServerMsg) => void;
  run?: RunReview;
  readDiff?: typeof readInspectionDiff;
  fingerprint?: typeof worktreeFingerprint;
  /** What a crew member's changes are measured against; null when it can't be inspected. */
  homeRef?: (crewId: string) => Promise<string | null>;
}

/** An inspection accepted for a crew member: its row is `running` until it's through. */
interface Job {
  id: string;
  crewId: string;
  deckId: string;
  cwd: string;
  flight: number;
  trigger: InspectionTrigger;
  plan: LaunchPlan;
  prompt: { brief: string | null; task: string; checks: { name: string; verdict: string }[] };
  files: ChangedStat[];
  diff: string;
  /** Why the diff couldn't be read, when it couldn't. */
  failed?: string;
  abort: AbortController;
  /** Its AI review has started (it's not queued any more). */
  reviewing: boolean;
}

/** Holds a crew member's place while its worktree is being read. */
type Pending = { pending: true };

/** A review waiting for its turn: `start(true)` when it gets one, `start(false)` when dropped. */
type Waiting = { job: Job; start: (go: boolean) => void };

type Row = typeof inspections.$inferSelect;

const isBlocker = (f: Finding) => f.severity === "blocker";

/**
 * The Inspector: once a stop passes pre-flight (or stops with changes on a deck with no armed
 * checks), check the change against its brief and have a read-only `claude -p` review it. Blockers
 * on a stop are typed back to the agent on pre-flight's fuel; notes are only shown.
 */
export class InspectionService {
  readonly #db: Db;
  readonly #crew: CrewService;
  readonly #checks: CheckService;
  readonly #briefs: InspectionDeps["briefs"];
  readonly #preflight: InspectionDeps["preflight"];
  readonly #providers: Record<string, ProviderAdapter>;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #run: RunReview;
  readonly #readDiff: typeof readInspectionDiff;
  readonly #fingerprint: typeof worktreeFingerprint;
  readonly #homeRef: (crewId: string) => Promise<string | null>;
  /** One entry per crew member with an inspection on the way, so it never has two. */
  readonly #busy = new Map<string, Job | Pending>();
  readonly #active = new Map<string, Job>();
  readonly #waiting: Waiting[] = [];
  #reviews = 0;
  /** Crew whose hand-back is being typed: that prompt is the Inspector's own, not a new one. */
  readonly #handingBack = new Set<string>();

  constructor(deps: InspectionDeps) {
    this.#db = deps.db;
    this.#crew = deps.crew;
    this.#checks = deps.checks;
    this.#briefs = deps.briefs;
    this.#preflight = deps.preflight;
    this.#providers = deps.providers;
    this.#broadcast = deps.broadcast;
    this.#run = deps.run ?? runReview;
    this.#readDiff = deps.readDiff ?? readInspectionDiff;
    this.#fingerprint = deps.fingerprint ?? worktreeFingerprint;
    this.#homeRef = deps.homeRef ?? ((crewId) => this.#deckHead(crewId));
    this.#crew.onPrompt(({ crewId }) => {
      if (!this.#handingBack.has(crewId)) this.cancel(crewId);
    });
    this.#crew.onGone((crewId) => this.cancel(crewId));
  }

  /** A stop passed pre-flight on the worktree `print`: inspect it, unless it already was. */
  afterGo(crewId: string, print: Print): void {
    this.#inspect(crewId, "stop", print).catch((error: unknown) =>
      console.error("[inspection] couldn't start an inspection", error),
    );
  }

  /**
   * Going back to work cancels an inspection. A stop on a deck whose checks aren't armed, or have
   * none on, is inspected here; otherwise pre-flight's GO brings it (afterGo).
   */
  handleSignal(e: CrewSignalEvent): void {
    if (e.signal.type === "working") {
      this.cancel(e.crewId, "superseded");
      return;
    }
    if (e.signal.type !== "stopped") return;
    const row = this.#crewRow(e.crewId);
    if (!row) return;
    const armed = this.#checks.armed(row.deckId) === true;
    if (armed && this.#checks.enabled(row.deckId).length > 0) return;
    this.inspect(e.crewId, "stop").catch((error: unknown) =>
      console.error("[inspection] couldn't start an inspection", error),
    );
  }

  /**
   * Inspect a crew member's worktree. Resolves with the inspection's id once accepted, or null
   * when there's nothing to do: the deck's Inspector is off, a shell or crew in the deck's
   * checkout, one already on the way, or (on a stop) a brief still being planned, a worktree
   * inspected as it is now, or one with no changes.
   */
  inspect(crewId: string, trigger: InspectionTrigger): Promise<string | null> {
    return this.#inspect(crewId, trigger);
  }

  async #inspect(
    crewId: string,
    trigger: InspectionTrigger,
    given?: Print,
  ): Promise<string | null> {
    if (this.#busy.has(crewId)) return null;
    if (trigger === "stop" && this.#briefs.planning(crewId)) return null;
    const row = this.#crewRow(crewId);
    if (!row || !this.enabled(row.deckId)) return null;
    const adapter = this.#providers[row.provider];
    if (!adapter?.reviewPlan) return null;
    const { cwd, ownWorktree } = this.#crew.workdir(crewId);
    if (!ownWorktree) return null;

    const pending: Pending = { pending: true };
    this.#busy.set(crewId, pending);
    const mine = () => this.#busy.get(crewId) === pending;
    const letGo = () => {
      if (mine()) this.#busy.delete(crewId);
      return null;
    };
    let homeRef: string | null;
    let print: Print;
    try {
      homeRef = await this.#homeRef(crewId);
      if (homeRef === null) return letGo();
      print = given ?? (await this.#fingerprint(cwd));
    } catch (error) {
      console.warn(`[inspection] can't read ${cwd}: ${(error as Error).message}`);
      return letGo();
    }
    // Cancelled while we looked.
    if (!mine()) return null;
    const last = this.latest(crewId);
    if (
      trigger === "stop" &&
      last &&
      last.state !== "cancelled" &&
      last.fingerprint === print.hash
    ) {
      letGo();
      // Handed blockers back, it stopped without touching anything: that needs you.
      if (last.trigger === "stop" && last.state === "flagged" && last.flight === row.flight) {
        this.#crew.alert(
          crewId,
          `${flaggedDetail(last.findings)}; ${row.name} stopped without changes`,
        );
      }
      return null;
    }

    let files: ChangedStat[] = [];
    let diff = "";
    let failed: string | undefined;
    try {
      ({ files, diff } = await this.#readDiff(cwd, homeRef));
    } catch (error) {
      // The worktree went away: nothing to inspect, nothing to report.
      if (!existsSync(cwd)) return letGo();
      failed = (error as Error).message;
    }
    if (!mine()) return null;
    // A stop pre-flight didn't run on: only a worktree with changes is inspected.
    if (!given && trigger === "stop" && failed === undefined && files.length === 0) return letGo();
    const member = this.#crewRow(crewId);
    if (!member) return letGo();

    const brief = this.#briefs.approvedForTask(crewId);
    const job: Job = {
      id: crypto.randomUUID(),
      crewId,
      deckId: member.deckId,
      cwd,
      flight: member.flight,
      trigger,
      plan: adapter.reviewPlan({ cwd }),
      prompt: { brief: brief?.text ?? null, task: member.task, checks: this.#checksFor(member) },
      files,
      diff,
      ...(failed !== undefined && { failed }),
      abort: new AbortController(),
      reviewing: false,
    };
    // Only stop runs are attempts; a manual run carries the attempt it follows (0 before any).
    const stops = this.#stopAttempts(crewId);
    this.#db
      .insert(inspections)
      .values({
        id: job.id,
        deckId: job.deckId,
        crewId,
        flight: job.flight,
        attempt: trigger === "stop" ? stops + 1 : stops,
        trigger,
        state: "running",
        fingerprint: print.hash,
        commit: print.commit,
        briefId: brief?.id ?? null,
        startedAt: Date.now(),
      })
      .run();
    this.#busy.set(crewId, job);
    this.#active.set(job.id, job);
    this.#changed(job, "running");
    void this.#execute(job)
      .catch((error: unknown) => {
        console.error("[inspection] run failed", error);
        const message = (error as Error).message;
        this.#settle(job, { state: "cancelled", reason: `failed: ${message}` }, message);
      })
      .finally(() => {
        this.#active.delete(job.id);
        if (this.#busy.get(crewId) === job) this.#busy.delete(crewId);
        this.#crew.refresh(job.deckId);
      });
    return job.id;
  }

  /** Stop a crew member's inspection: a queued review is dropped, a running one aborted. */
  cancel(crewId: string, reason = "superseded"): void {
    const entry = this.#busy.get(crewId);
    if (!entry) return;
    this.#busy.delete(crewId);
    if ("pending" in entry) return;
    entry.abort.abort();
    const queued = this.#waiting.findIndex((w) => w.job === entry);
    if (queued >= 0) this.#waiting.splice(queued, 1)[0]!.start(false);
    this.#settle(entry, { state: "cancelled", reason });
  }

  /**
   * Whether the Inspector isn't through with a crew member yet: an inspection is on the way
   * (looking, queued, or running), or this flight's latest is a flagged stop with a hand-back
   * coming or just typed (fuel left, or the last one typed and the agent not yet back at work).
   */
  busy(crewId: string): boolean {
    if (this.#busy.has(crewId)) return true;
    const row = this.#crewRow(crewId);
    if (!row || row.status === "asleep") return false;
    // Switched off: nothing is handed back.
    if (!this.enabled(row.deckId)) return false;
    const last = this.history(crewId)[0];
    if (!last || last.trigger !== "stop" || last.state !== "flagged") return false;
    return row.fuel > 0 || row.status === "done";
  }

  /** The roster's summary: this flight's latest inspection. */
  info(crewId: string): InspectionInfo | undefined {
    const record = this.latest(crewId);
    if (!record) return undefined;
    const row = this.#crewRow(crewId);
    // A new flight (your prompt) with nothing inspected yet has nothing to show.
    if (row && record.flight < row.flight) return undefined;
    const blockers = record.findings.filter(isBlocker);
    const job = this.#active.get(record.id);
    return {
      state: record.state,
      blockers: blockers.length,
      notes: record.findings.length - blockers.length,
      ...(blockers[0] && { firstBlocker: blockers[0].title }),
      ...(record.state === "running" && job && !job.reviewing && { queued: true as const }),
    };
  }

  latest(crewId: string): InspectionRecord | null {
    return this.#records(eq(inspections.crewId, crewId), 1)[0] ?? null;
  }

  /** This flight's inspections, newest first. */
  history(crewId: string): InspectionRecord[] {
    const flight = this.#crewRow(crewId)?.flight ?? this.latest(crewId)?.flight;
    if (flight === undefined) return [];
    return this.#records(and(eq(inspections.crewId, crewId), eq(inspections.flight, flight))!);
  }

  /** Whether the deck's Inspector reviews its stops. */
  enabled(deckId: string): boolean {
    return this.#checks.inspector(deckId);
  }

  /** Switch the deck's Inspector on or off; a review already running finishes without a hand-back. */
  setEnabled(deckId: string, on: boolean): void {
    this.#db.update(decks).set({ inspector: on }).where(eq(decks.id, deckId)).run();
    this.#broadcast(this.#checks.message(deckId));
  }

  /** On startup: inspections left "running" by a station that stopped are cancelled. */
  reconcile(): void {
    const mine = [...this.#active.keys()];
    this.#db
      .update(inspections)
      .set({ state: "cancelled", reason: "restart", finishedAt: Date.now() })
      .where(
        and(
          eq(inspections.state, "running"),
          mine.length ? notInArray(inspections.id, mine) : undefined,
        ),
      )
      .run();
  }

  async #execute(job: Job): Promise<void> {
    if (job.failed !== undefined) {
      this.#settle(job, { state: "cancelled", reason: `failed: ${job.failed}` }, job.failed);
      return;
    }
    if (job.files.length === 0) {
      this.#settle(job, { state: "cleared", findings: [] });
      return;
    }
    const scope = scopeCheck(job.files, job.prompt.brief);
    const prompt = reviewPrompt({ ...job.prompt, scope, diff: job.diff });
    if (!(await this.#turn(job))) return;
    let review;
    try {
      if (job.abort.signal.aborted) return;
      job.reviewing = true;
      this.#changed(job, "running");
      review = await this.#run({
        plan: job.plan,
        prompt,
        timeoutMs: REVIEW_TIMEOUT_MS,
        signal: job.abort.signal,
      });
    } finally {
      this.#reviews--;
      this.#pump();
    }
    if (job.abort.signal.aborted) return;
    if (!existsSync(job.cwd)) {
      // The worktree went away under the review: nothing to report, no fuel spent.
      this.#settle(job, { state: "cancelled", reason: "worktree gone" });
      return;
    }
    if (!review.ok) {
      const why = review.error ?? `Exited with code ${review.exitCode}`;
      this.#settle(job, { state: "cancelled", reason: `failed: ${why}` }, why);
      return;
    }
    const findings = [...scope, ...parseReview(review.stdout)];
    const flagged = findings.some(isBlocker);
    if (!this.#settle(job, { state: flagged ? "flagged" : "cleared", findings })) return;
    if (flagged) await this.#handBack(job, findings);
  }

  /**
   * After a stop's blockers: type them into the agent and spend one fuel, or, with the tank empty
   * (or the agent unreachable), raise "needs you". A manual run, or a deck whose Inspector was
   * switched off meanwhile, hands nothing back.
   */
  async #handBack(job: Job, findings: Finding[]): Promise<void> {
    if (job.trigger !== "stop" || job.abort.signal.aborted) return;
    const member = this.#crewRow(job.crewId);
    if (!member || member.flight !== job.flight || !this.enabled(job.deckId)) return;
    const outcome = afterVerdict(false, member.fuel, this.#stopAttempts(job.crewId));
    if (outcome.kind === "go") return;
    if (outcome.kind === "outOfFuel") {
      this.#crew.alert(job.crewId, flaggedDetail(findings));
      return;
    }
    // At a permission prompt, typing would answer it: leave it to you, spending nothing.
    if (member.status === "needs_input" && !this.#crew.waitingIdle(job.crewId)) return;
    const message = inspectionHandBack(
      findings.filter(isBlocker),
      outcome.attempt,
      outcome.maxAttempts,
    );
    this.#handingBack.add(job.crewId);
    try {
      await this.#crew.prompt(job.crewId, message, "station");
    } catch (error) {
      console.warn(`[inspection] couldn't hand back to ${job.crewId}: ${(error as Error).message}`);
      this.#crew.alert(job.crewId, `${flaggedDetail(findings)} (couldn't reach the agent)`);
      return;
    } finally {
      this.#handingBack.delete(job.crewId);
    }
    this.#db
      .update(crewTable)
      .set({ fuel: sql`max(${crewTable.fuel} - 1, 0)` })
      .where(and(eq(crewTable.id, job.crewId), eq(crewTable.flight, job.flight)))
      .run();
  }

  /** Wait for a review slot; false when the inspection was dropped first. */
  #turn(job: Job): Promise<boolean> {
    return new Promise((start) => {
      this.#waiting.push({ job, start });
      this.#pump();
    });
  }

  #pump(): void {
    while (this.#reviews < MAX_REVIEWS && this.#waiting.length > 0) {
      const next = this.#waiting.shift()!;
      if (next.job.abort.signal.aborted) {
        next.start(false);
        continue;
      }
      this.#reviews++;
      next.start(true);
    }
  }

  /**
   * Finish a running inspection's row and say so; false when it was already through (cancelled
   * while the review ran).
   */
  #settle(
    job: Job,
    outcome: { state: InspectionState; reason?: string; findings?: Finding[] },
    failed?: string,
  ): boolean {
    const { changes } = this.#db
      .update(inspections)
      .set({
        state: outcome.state,
        reason: outcome.reason ?? null,
        ...(outcome.findings && { findings: JSON.stringify(outcome.findings) }),
        finishedAt: Date.now(),
      })
      .where(and(eq(inspections.id, job.id), eq(inspections.state, "running")))
      .run();
    if (changes === 0) return false;
    this.#changed(job, outcome.state, failed);
    return true;
  }

  #changed(job: Job, state: InspectionState, failed?: string): void {
    this.#crew.refresh(job.deckId);
    this.#broadcast({
      type: "crew.inspection",
      deckId: job.deckId,
      crewId: job.crewId,
      inspectionId: job.id,
      state,
      ...(failed !== undefined && { failed }),
    });
  }

  /** This flight's attempts: stop inspections that weren't cancelled. Manual runs don't count. */
  #stopAttempts(crewId: string): number {
    return this.history(crewId).filter((r) => r.trigger === "stop" && r.state !== "cancelled")
      .length;
  }

  /** The latest pre-flight's verdicts, for the review; none when the deck's checks aren't armed. */
  #checksFor(row: typeof crewTable.$inferSelect): { name: string; verdict: string }[] {
    if (this.#checks.armed(row.deckId) !== true) return [];
    return (this.#preflight.latest(row.id)?.results ?? []).map((r) => ({
      name: r.name,
      verdict: r.verdict,
    }));
  }

  /** The deck checkout's HEAD, which a worktree of its own branched from; null without one. */
  async #deckHead(crewId: string): Promise<string | null> {
    const { repoPath, ownWorktree } = this.#crew.workdir(crewId);
    if (!ownWorktree) return null;
    const { stdout } = await exec("git", ["-C", repoPath, "rev-parse", "HEAD"]);
    return stdout.trim();
  }

  #records(where: SQL, limit?: number): InspectionRecord[] {
    const query = this.#db
      .select()
      .from(inspections)
      .where(where)
      .orderBy(desc(inspections.startedAt), desc(sql`rowid`));
    return (limit === undefined ? query.all() : query.limit(limit).all()).map(toRecord);
  }

  #crewRow(crewId: string) {
    return this.#db.select().from(crewTable).where(eq(crewTable.id, crewId)).get();
  }
}

function toRecord(row: Row): InspectionRecord {
  return {
    id: row.id,
    crewId: row.crewId,
    deckId: row.deckId,
    flight: row.flight,
    attempt: row.attempt,
    trigger: row.trigger,
    state: row.state,
    ...(row.reason !== null && { reason: row.reason }),
    fingerprint: row.fingerprint,
    commit: row.commit,
    findings: parseFindings(row.findings),
    ...(row.briefId !== null && { briefId: row.briefId }),
    startedAt: row.startedAt,
    ...(row.finishedAt !== null && { finishedAt: row.finishedAt }),
  };
}

function parseFindings(json: string): Finding[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Finding[]) : [];
  } catch {
    return [];
  }
}
