import type { CheckVerdict, DeckCheck, PreflightInfo, ServerMsg } from "@spaceship/protocol";
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
  /** Spaceship home; logs go to `<home>/preflight/<preflightId>/<checkId>.log`. */
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
  #planning: (crewId: string) => boolean = () => false;
  #onGo: (crewId: string, print: { hash: string; commit: string }) => void = () => {};

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

  /**
   * Ask whether a crew member is still planning (its brief waits or was revised): a stop then is Claude
   * asking or waiting on its plan, with nothing built to check and no place for a hand-back.
   */
  planningWith(fn: (crewId: string) => boolean): void {
    this.#planning = fn;
  }

  /**
   * Hear about a stop that passed: a stop run's GO, or a stop with nothing changed since one.
   * `print` is the worktree the checks passed on.
   */
  onGo(fn: (crewId: string, print: { hash: string; commit: string }) => void): void {
    this.#onGo = fn;
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
   * the last run or a brief still being planned (waiting or revised).
   */
  async run(crewId: string, trigger: PreflightTrigger): Promise<string | null> {
    if (this.#busy.has(crewId)) return null;
    if (trigger === "stop" && this.#planning(crewId)) return null;
    const row = this.#crewRow(crewId);
    if (!row || row.provider === "shell") return null;
    const { cwd, ownWorktree } = this.#crew.workdir(crewId);
    if (!ownWorktree) return null;
    const armed = this.#checks.armed(row.deckId);
    if (armed === null && trigger === "stop") this.#detectFor(row.deckId);
    if (armed !== true) return null;
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
      // Handed a NO-GO back, it stopped without touching anything: that needs you, not more fuel.
      if (last.trigger === "stop" && last.state === "nogo" && last.flight === row.flight) {
        const names = last.results.filter((r) => r.verdict === "nogo").map((r) => r.name);
        this.#crew.alert(
          crewId,
          `${names.join(", ")} still NO-GO; ${row.name} stopped without changes`,
        );
      }
      // Passed on this very worktree: still a GO, for whatever follows one.
      if (last.trigger === "stop" && last.state === "go" && last.flight === row.flight) {
        this.#onGo(crewId, print);
      }
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

  /**
   * You said yes to the deck's checks: arm them, then run them for the agents sitting at their
   * prompt (stopped, idle, or only idling there), as if they'd just stopped (so one with no change
   * since its last run is skipped). Never one at a permission prompt: a hand-back typed there
   * would answer it.
   */
  async arm(deckId: string): Promise<void> {
    this.#checks.arm(deckId, true);
    const stopped = this.#crew
      .roster(deckId)
      .filter(
        (member) =>
          member.kind === "agent" &&
          (member.status === "done" ||
            member.status === "idle" ||
            (member.status === "needs_input" && this.#crew.waitingIdle(member.id))),
      );
    await Promise.all(stopped.map((member) => this.run(member.id, "stop")));
  }

  /** A deck nobody has been asked about: find its checks, so the arm card has a list to show. */
  #detectFor(deckId: string): void {
    this.#checks
      .ensureDetected(deckId)
      .catch((error: unknown) =>
        console.warn(
          `[preflight] couldn't detect checks for ${deckId}: ${(error as Error).message}`,
        ),
      );
  }

  /**
   * Whether pre-flight isn't through with a crew member yet: a run is on the way (looking,
   * queued, or running), or this flight's latest run is a stop NO-GO with a hand-back coming or
   * just typed (fuel left, or the last one typed and the agent not yet back at work).
   */
  busy(crewId: string): boolean {
    if (this.#busy.has(crewId)) return true;
    const row = this.#crewRow(crewId);
    if (!row || row.status === "asleep") return false;
    // Disarmed, or no checks on: no stop will run anything, so no hand-back is coming.
    if (this.#checks.armed(row.deckId) !== true || this.#checks.enabled(row.deckId).length === 0) {
      return false;
    }
    const last = this.history(crewId)[0];
    if (!last || last.trigger !== "stop" || last.state !== "nogo") return false;
    return row.fuel > 0 || row.status === "done";
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
    // A new flight (your prompt) with nothing run yet has nothing to show.
    if (row && record.flight < row.flight) return undefined;
    const attempt = row ? this.#stopAttempts(crewId) : record.attempt;
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
          // Not a verdict on the work: nothing to hand back, nothing to show as NO-GO.
          console.error("[preflight] run failed", error);
          this.#db
            .update(preflights)
            .set({ state: "cancelled", finishedAt: Date.now() })
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
    // Only stop runs are attempts; a manual run carries the attempt it follows (0 before any).
    const stops = this.#db
      .select({ n: sql<number>`count(*)` })
      .from(preflights)
      .where(
        and(
          eq(preflights.crewId, job.crewId),
          eq(preflights.flight, member.flight),
          eq(preflights.trigger, "stop"),
          ne(preflights.state, "cancelled"),
        ),
      )
      .get()!.n;
    const attempt = job.trigger === "stop" ? stops + 1 : stops;
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
    let passedOn = job.hash;
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
      // What the worktree holds once the checks are through, files they wrote included (snapshots,
      // coverage, --fix), so the next unchanged stop and O's guard both see a match.
      const hash = done ? await this.#refingerprint(job) : job.hash;
      if (job.abort.signal.aborted) return;
      passedOn = hash;
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
              fingerprint: hash,
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
    await this.#handBack(job, member.flight, verdicts, failures, passedOn);
  }

  /**
   * After a stop's GO: say so (onGo). After its NO-GO: type the failures into the agent and spend one fuel, or, with the tank
   * empty (or the agent unreachable), raise "needs you". A manual run spends no fuel.
   */
  async #handBack(
    job: Job,
    flight: number,
    verdicts: CheckVerdict[],
    failures: CheckFailure[],
    hash: string,
  ): Promise<void> {
    if (job.trigger !== "stop" || job.abort.signal.aborted) return;
    const member = this.#crewRow(job.crewId);
    if (!member || member.flight !== flight) return;
    const attempt = this.#stopAttempts(job.crewId);
    const outcome = afterPreflight(verdicts, member.fuel, attempt);
    if (outcome.kind === "go") {
      this.#onGo(job.crewId, { hash, commit: job.commit });
      return;
    }
    const names = failures.map((f) => f.name);
    if (outcome.kind === "outOfFuel") {
      this.#crew.alert(job.crewId, outOfFuelDetail(names, outcome.attempts));
      return;
    }
    // At a permission prompt, typing would answer it: leave it to you, spending nothing.
    if (member.status === "needs_input" && !this.#crew.waitingIdle(job.crewId)) return;
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

  /** This flight's stop runs that finished, for numbering attempts shared with the Inspector. */
  stopAttempts(crewId: string): number {
    return this.#stopAttempts(crewId);
  }

  /** This flight's attempts: stop runs that finished. Manual runs spend no fuel, so don't count. */
  #stopAttempts(crewId: string): number {
    return this.history(crewId).filter((r) => r.trigger === "stop" && r.state !== "cancelled")
      .length;
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

  /** The worktree's fingerprint after the run; the one taken before it if it can't be read. */
  async #refingerprint(job: Job): Promise<string> {
    try {
      return (await this.#fingerprint(job.cwd)).hash;
    } catch (error) {
      console.warn(`[preflight] can't read ${job.cwd}: ${(error as Error).message}`);
      return job.hash;
    }
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
