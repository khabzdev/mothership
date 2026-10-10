import type { CheckVerdict, DeckCheck, PreflightInfo, ServerMsg } from "@mothership/protocol";
import { and, asc, desc, eq, inArray, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../../shared/db/client.server";
import { crew as crewTable, preflightResults, preflights } from "../../shared/db/schema";
import type { CrewSignalEvent } from "../crew/hooks.server";
import type { CrewService, PromptFrom } from "../crew/service.server";
import type { CheckService } from "./checks.server";
import { fingerprint as worktreeFingerprint } from "./fingerprint.server";
import { afterPreflight, DEFAULT_FUEL } from "./flight";
import { handBackMessage, outOfFuelDetail, tailOf, type CheckFailure } from "./report";
import { runCheck, type CheckRun, type RunCheck } from "./runner.server";

/** At most this many pre-flights run at once, station-wide; the rest wait their turn. */
export const MAX_RUNNING = 2;

export type PreflightTrigger = "stop" | "manual";

export interface PreflightResult {
  checkId: string;
  name: string;
  command: string;
  verdict: CheckVerdict;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  tail: string;
}

export interface PreflightRecord {
  id: string;
  crewId: string;
  deckId: string;
  flight: number;
  attempt: number;
  state: PreflightInfo["state"];
  trigger: PreflightTrigger;
  commit: string;
  fingerprint: string;
  startedAt: number;
  finishedAt?: number;
  results: PreflightResult[];
}

interface Deps {
  db: Db;
  crew: CrewService;
  checks: CheckService;
  broadcast: (msg: ServerMsg) => void;
  /** Mothership home; logs go to `<home>/preflight/<preflightId>/<checkId>.log`. */
  home: string;
  run?: RunCheck;
  fingerprint?: typeof worktreeFingerprint;
}

/** A pre-flight accepted for a crew member: waiting for a slot, or running. */
interface Job {
  id: string;
  crewId: string;
  deckId: string;
  cwd: string;
  trigger: PreflightTrigger;
  checks: DeckCheck[];
  commit: string;
  hash: string;
  abort: AbortController;
  started: boolean;
}

/** Holds a crew member's place while its worktree is being fingerprinted. */
type Pending = { pending: true };

type Row = typeof preflights.$inferSelect;

/**
 * Pre-flight: when a crew member in a worktree of its own stops, run the deck's armed checks
 * there, one after another, and remember how each came out. A NO-GO is typed back to the agent
 * while the flight has fuel; then it needs you. Your next prompt starts a new flight, refuelled.
 */
export class PreflightService {
  readonly #db: Db;
  readonly #crew: CrewService;
  readonly #checks: CheckService;
  readonly #broadcast: (msg: ServerMsg) => void;
  readonly #home: string;
  readonly #run: RunCheck;
  readonly #fingerprint: typeof worktreeFingerprint;
  /** One entry per crew member with a pre-flight on the way, so it never has two. */
  readonly #busy = new Map<string, Job | Pending>();
  readonly #queue: Job[] = [];
  readonly #active = new Map<string, Job>();

  constructor(deps: Deps) {
    this.#db = deps.db;
    this.#crew = deps.crew;
    this.#checks = deps.checks;
    this.#broadcast = deps.broadcast;
    this.#home = deps.home;
    this.#run = deps.run ?? runCheck;
    this.#fingerprint = deps.fingerprint ?? worktreeFingerprint;
    this.#crew.onPrompt((e) => this.#prompted(e));
    this.#crew.onGone((crewId) => this.cancel(crewId));
  }

  /** A stop starts a pre-flight; going back to work cancels one, spending no fuel. */
  handleSignal(e: CrewSignalEvent): void {
    if (e.signal.type === "working") {
      this.cancel(e.crewId);
      return;
    }
    if (e.signal.type !== "stopped") return;
    this.run(e.crewId, "stop").catch((error: unknown) =>
      console.error("[preflight] couldn't start a pre-flight", error),
    );
  }

  /**
   * Start a pre-flight for a crew member, or queue it behind the ones running. Resolves with its
   * id once accepted, or null when there's nothing to run: a shell, crew in the deck's checkout,
   * a deck not armed or with no checks on, one already on the way, or (on a stop) no change since
   * the last run.
   */
  async run(crewId: string, trigger: PreflightTrigger): Promise<string | null> {
    if (this.#busy.has(crewId)) return null;
    const row = this.#crewRow(crewId);
    if (!row || row.provider === "shell") return null;
    const { cwd, ownWorktree } = this.#crew.workdir(crewId);
    if (!ownWorktree || this.#checks.armed(row.deckId) !== true) return null;
    const checks = this.#checks.enabled(row.deckId);
    if (checks.length === 0) return null;

    const pending: Pending = { pending: true };
    this.#busy.set(crewId, pending);
    let print: { hash: string; commit: string };
    try {
      print = await this.#fingerprint(cwd);
    } catch (error) {
      if (this.#busy.get(crewId) === pending) this.#busy.delete(crewId);
      console.warn(`[preflight] can't read ${cwd}: ${(error as Error).message}`);
      return null;
    }
    // Cancelled while we looked.
    if (this.#busy.get(crewId) !== pending) return null;
    const last = this.latest(crewId);
    if (
      trigger === "stop" &&
      last &&
      last.state !== "cancelled" &&
      last.fingerprint === print.hash
    ) {
      this.#busy.delete(crewId);
      return null;
    }

    const job: Job = {
      id: crypto.randomUUID(),
      crewId,
      deckId: row.deckId,
      cwd,
      trigger,
      checks,
      commit: print.commit,
      hash: print.hash,
      abort: new AbortController(),
      started: false,
    };
    this.#busy.set(crewId, job);
    this.#queue.push(job);
    this.#pump();
    return job.id;
  }

  /** Stop a crew member's pre-flight: a queued one is dropped, a running one is cancelled. */
  cancel(crewId: string): void {
    const entry = this.#busy.get(crewId);
    if (!entry) return;
    this.#busy.delete(crewId);
    if ("pending" in entry) return;
    const queued = this.#queue.indexOf(entry);
    if (queued >= 0) {
      this.#queue.splice(queued, 1);
      return;
    }
    entry.abort.abort();
    this.#db
      .update(preflights)
      .set({ state: "cancelled", finishedAt: Date.now() })
      .where(and(eq(preflights.id, entry.id), eq(preflights.state, "running")))
      .run();
    this.#crew.refresh(entry.deckId);
  }

  /** The roster's summary: the latest pre-flight, with this flight's attempts and fuel left. */
  info(crewId: string): PreflightInfo | undefined {
    const record = this.latest(crewId);
    if (!record) return undefined;
    const row = this.#crewRow(crewId);
    const attempt = row
      ? this.history(crewId).filter((r) => r.state !== "cancelled").length
      : record.attempt;
    const job = this.#active.get(record.id);
    const checks = job
      ? job.checks.map((check, i) => {
          const verdict = record.results[i]?.verdict;
          return { name: check.name, ...(verdict && { verdict }) };
        })
      : record.results.map((r) => ({ name: r.name, verdict: r.verdict }));
    return {
      state: record.state,
      checks,
      attempt,
      fuel: row?.fuel ?? DEFAULT_FUEL,
      maxFuel: DEFAULT_FUEL,
    };
  }

  latest(crewId: string): PreflightRecord | null {
    return this.#records(eq(preflights.crewId, crewId), 1)[0] ?? null;
  }

  /** This flight's runs, newest first. */
  history(crewId: string): PreflightRecord[] {
    const flight = this.#crewRow(crewId)?.flight ?? this.latest(crewId)?.flight;
    if (flight === undefined) return [];
    return this.#records(and(eq(preflights.crewId, crewId), eq(preflights.flight, flight))!);
  }

  deckHistory(deckId: string, limit = 10): PreflightRecord[] {
    return this.#records(eq(preflights.deckId, deckId), limit);
  }

  /** On startup: runs left "running" by a station that stopped are cancelled. */
  reconcile(): void {
    const mine = [...this.#active.keys()];
    this.#db
      .update(preflights)
      .set({ state: "cancelled", finishedAt: Date.now() })
      .where(
        and(
          eq(preflights.state, "running"),
          mine.length ? notInArray(preflights.id, mine) : undefined,
        ),
      )
      .run();
  }

  #pump(): void {
    while (this.#active.size < MAX_RUNNING && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      this.#active.set(job.id, job);
      void this.#execute(job)
        .catch((error: unknown) => {
          console.error("[preflight] run failed", error);
          this.#db
            .update(preflights)
            .set({ state: "nogo", finishedAt: Date.now() })
            .where(and(eq(preflights.id, job.id), eq(preflights.state, "running")))
            .run();
        })
        .finally(() => {
          this.#active.delete(job.id);
          if (this.#busy.get(job.crewId) === job) this.#busy.delete(job.crewId);
          this.#crew.refresh(job.deckId);
          this.#pump();
        });
    }
  }

  async #execute(job: Job): Promise<void> {
    const member = this.#crewRow(job.crewId);
    if (!member) return;
    const attempt =
      this.#db
        .select({ n: sql<number>`count(*)` })
        .from(preflights)
        .where(
          and(
            eq(preflights.crewId, job.crewId),
            eq(preflights.flight, member.flight),
            ne(preflights.state, "cancelled"),
          ),
        )
        .get()!.n + 1;
    this.#db
      .insert(preflights)
      .values({
        id: job.id,
        deckId: job.deckId,
        crewId: job.crewId,
        flight: member.flight,
        attempt,
        state: "running",
        trigger: job.trigger,
        commit: job.commit,
        fingerprint: job.hash,
        startedAt: Date.now(),
      })
      .run();
    job.started = true;
    this.#crew.refresh(job.deckId);

    const verdicts: CheckVerdict[] = [];
    const failures: CheckFailure[] = [];
    for (const [position, check] of job.checks.entries()) {
      if (job.abort.signal.aborted) return;
      const run = await this.#check(job, check);
      if (job.abort.signal.aborted) return;
      if (!existsSync(job.cwd)) {
        // The worktree went away under the run: nothing to report, no fuel spent.
        this.cancel(job.crewId);
        return;
      }
      const tail = tailOf(run.output);
      verdicts.push(run.verdict);
      if (run.verdict === "nogo") {
        const { name, command, timeoutMs } = check;
        const { exitCode, timedOut, durationMs } = run;
        failures.push({ name, command, exitCode, timedOut, timeoutMs, durationMs, tail });
      }
      const done = position === job.checks.length - 1;
      this.#db.transaction((tx) => {
        tx.insert(preflightResults)
          .values({
            preflightId: job.id,
            checkId: check.id,
            position,
            name: check.name,
            command: check.command,
            verdict: run.verdict,
            exitCode: run.exitCode,
            timedOut: run.timedOut,
            durationMs: run.durationMs,
            tail,
          })
          .run();
        if (done) {
          tx.update(preflights)
            .set({
              state: verdicts.every((v) => v === "go") ? "go" : "nogo",
              finishedAt: Date.now(),
            })
            .where(eq(preflights.id, job.id))
            .run();
        }
      });
      this.#broadcast({
        type: "crew.preflight",
        deckId: job.deckId,
        crewId: job.crewId,
        preflightId: job.id,
        check: check.name,
        verdict: run.verdict,
        done,
      });
      this.#crew.refresh(job.deckId);
    }
    await this.#handBack(job, member.flight, attempt, verdicts, failures);
  }

  /**
   * After a stop's NO-GO: type the failures into the agent and spend one fuel, or, with the tank
   * empty (or the agent unreachable), raise "needs you". A manual run spends no fuel.
   */
  async #handBack(
    job: Job,
    flight: number,
    attempt: number,
    verdicts: CheckVerdict[],
    failures: CheckFailure[],
  ): Promise<void> {
    if (job.trigger !== "stop" || job.abort.signal.aborted) return;
    const member = this.#crewRow(job.crewId);
    if (!member || member.flight !== flight) return;
    const outcome = afterPreflight(verdicts, member.fuel, attempt);
    if (outcome.kind === "go") return;
    const names = failures.map((f) => f.name);
    if (outcome.kind === "outOfFuel") {
      this.#crew.alert(job.crewId, outOfFuelDetail(names, outcome.attempts));
      return;
    }
    const message = handBackMessage(failures, outcome.attempt, outcome.maxAttempts);
    try {
      await this.#crew.prompt(job.crewId, message, "station");
    } catch (error) {
      console.warn(`[preflight] couldn't hand back to ${job.crewId}: ${(error as Error).message}`);
      this.#crew.alert(job.crewId, `${outOfFuelDetail(names, attempt)} (couldn't reach the agent)`);
      return;
    }
    this.#db
      .update(crewTable)
      .set({ fuel: sql`max(${crewTable.fuel} - 1, 0)` })
      .where(and(eq(crewTable.id, job.crewId), eq(crewTable.flight, flight)))
      .run();
  }

  /** Your prompt starts a new flight with a full tank, and cancels a pre-flight under way. */
  #prompted({ crewId, from }: { crewId: string; from: PromptFrom }): void {
    if (from !== "you") return;
    this.cancel(crewId);
    const row = this.#crewRow(crewId);
    if (!row) return;
    this.#db
      .update(crewTable)
      .set({ flight: sql`${crewTable.flight} + 1`, fuel: DEFAULT_FUEL })
      .where(eq(crewTable.id, crewId))
      .run();
    this.#crew.refresh(row.deckId);
  }

  /** Run one check; one that can't even start (no log folder) is NO-GO with the reason. */
  async #check(job: Job, check: DeckCheck): Promise<CheckRun> {
    const logPath = join(this.#home, "preflight", job.id, `${check.id}.log`);
    const started = Date.now();
    try {
      return await this.#run({
        command: check.command,
        cwd: job.cwd,
        timeoutMs: check.timeoutMs,
        logPath,
        signal: job.abort.signal,
      });
    } catch (error) {
      return {
        verdict: "nogo",
        exitCode: null,
        timedOut: false,
        durationMs: Date.now() - started,
        output: (error as Error).message,
        logPath,
      };
    }
  }

  #records(where: SQL, limit?: number): PreflightRecord[] {
    const query = this.#db
      .select()
      .from(preflights)
      .where(where)
      .orderBy(desc(preflights.startedAt), desc(sql`rowid`));
    const rows = limit === undefined ? query.all() : query.limit(limit).all();
    if (rows.length === 0) return [];
    const results = this.#db
      .select()
      .from(preflightResults)
      .where(
        inArray(
          preflightResults.preflightId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(preflightResults.position))
      .all();
    return rows.map((row) => toRecord(row, results));
  }

  #crewRow(crewId: string) {
    return this.#db.select().from(crewTable).where(eq(crewTable.id, crewId)).get();
  }
}

function toRecord(row: Row, results: (typeof preflightResults.$inferSelect)[]): PreflightRecord {
  return {
    id: row.id,
    crewId: row.crewId,
    deckId: row.deckId,
    flight: row.flight,
    attempt: row.attempt,
    state: row.state,
    trigger: row.trigger,
    commit: row.commit,
    fingerprint: row.fingerprint,
    startedAt: row.startedAt,
    ...(row.finishedAt !== null && { finishedAt: row.finishedAt }),
    results: results
      .filter((r) => r.preflightId === row.id)
      .map((r) => ({
        checkId: r.checkId,
        name: r.name,
        command: r.command,
        verdict: r.verdict,
        exitCode: r.exitCode,
        timedOut: r.timedOut,
        durationMs: r.durationMs,
        tail: r.tail,
      })),
  };
}
