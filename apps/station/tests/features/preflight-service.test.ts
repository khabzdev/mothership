import type { ServerMsg } from "@mothership/protocol";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { CrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewService } from "../../src/features/crew/service.server.ts";
import { CheckService } from "../../src/features/preflight/checks.server.ts";
import { launchGuard } from "../../src/features/preflight/guard.ts";
import { fingerprint } from "../../src/features/preflight/fingerprint.server.ts";
import { PreflightService } from "../../src/features/preflight/preflight.server.ts";
import type { CheckRun, RunCheck } from "../../src/features/preflight/runner.server.ts";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { crew as crewTable, deckChecks, decks, preflights } from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  writes: [string, string][] = [];
  fail = false;
  async launch() {}
  async write(crewId: string, data: string) {
    if (this.fail) throw new Error("pty closed");
    this.writes.push([crewId, data]);
  }
  async stop() {}
}

type RunOpts = Parameters<RunCheck>[0];

let scratch: string;
let home: string;
let repo: string;
let db: Db;
let sent: ServerMsg[];
let launcher: FakeLauncher;
let crew: CrewService;
let checks: CheckService;
let calls: RunOpts[];
let verdicts: CheckRun["verdict"][];
let run: RunCheck;
let service: PreflightService;
/** Throw from broadcast, to crash a run part-way. */
let crash = false;

const result = (opts: RunOpts, verdict: CheckRun["verdict"]): CheckRun => ({
  verdict,
  exitCode: verdict === "go" ? 0 : 1,
  timedOut: false,
  durationMs: 5,
  output: `ran ${opts.command}\n`,
  logPath: opts.logPath,
});

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-preflight-")));
  home = join(scratch, "home");
  repo = join(scratch, "shop");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "hi");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-qm",
    "init",
  ]);
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  db.insert(deckChecks)
    .values([
      { id: "k-check", deckId: "deck-1", name: "check", command: "vp check", position: 0 },
      { id: "k-test", deckId: "deck-1", name: "test", command: "vp test", position: 1 },
    ])
    .run();
  sent = [];
  crash = false;
  const broadcast = (msg: ServerMsg) => {
    if (crash && msg.type === "crew.preflight") throw new Error("boom");
    sent.push(msg);
  };
  launcher = new FakeLauncher();
  crew = new CrewService({ db, launcher, broadcast, home });
  checks = new CheckService({ db, broadcast });
  checks.arm("deck-1", true);
  calls = [];
  verdicts = [];
  run = async (opts) => {
    calls.push(opts);
    return result(opts, verdicts.shift() ?? "go");
  };
  service = new PreflightService({ db, crew, checks, broadcast, home, run: (o) => run(o) });
  crew.describeWith((id) => ({ preflight: service.info(id) }));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

/** Hire a crew member in a worktree of its own, with an uncommitted change in it. */
async function hireWithChange(consoleId = 0) {
  const member = await crew.hire({ deckId: "deck-1", consoleId, task: "Fix", worktree: true });
  writeFileSync(join(crew.workdir(member.id).cwd, "change.txt"), "new");
  return member;
}

const stop = (crewId: string) =>
  service.handleSignal({ crewId, missionId: crewId, signal: { type: "stopped" } });

const settled = (crewId: string) =>
  vi.waitFor(() => {
    const state = service.latest(crewId)?.state;
    if (!state || state === "running") throw new Error("still running");
  });

const preflightMsgs = () =>
  sent.filter(
    (m): m is Extract<ServerMsg, { type: "crew.preflight" }> => m.type === "crew.preflight",
  );

describe("PreflightService", () => {
  test("stop with changes runs every enabled check and stores them", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);

    expect(service.history(id)).toHaveLength(1);
    const record = service.latest(id)!;
    expect(record).toMatchObject({
      crewId: id,
      deckId: "deck-1",
      flight: 1,
      attempt: 1,
      state: "go",
      trigger: "stop",
    });
    expect(record.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(record.fingerprint).toMatch(/^[0-9a-f]{40}$/);
    expect(record.finishedAt).toBeGreaterThanOrEqual(record.startedAt);
    expect(record.results).toEqual([
      {
        checkId: "k-check",
        name: "check",
        command: "vp check",
        verdict: "go",
        exitCode: 0,
        timedOut: false,
        durationMs: 5,
        tail: "ran vp check",
      },
      expect.objectContaining({ checkId: "k-test", name: "test", verdict: "go" }),
    ]);
    const cwd = crew.workdir(id).cwd;
    expect(calls).toEqual([
      {
        command: "vp check",
        cwd,
        timeoutMs: 300_000,
        logPath: join(home, "preflight", record.id, "k-check.log"),
        signal: expect.any(AbortSignal),
      },
      expect.objectContaining({ command: "vp test", cwd }),
    ]);
  });

  test("a NO-GO check makes the run NO-GO", async () => {
    const { id } = await hireWithChange();
    verdicts = ["go", "nogo"];
    stop(id);
    await settled(id);
    expect(service.latest(id)?.state).toBe("nogo");
  });

  test("a check that can't start is recorded as NO-GO, never left running", async () => {
    const { id } = await hireWithChange();
    run = async () => {
      throw new Error("EACCES: permission denied, mkdir '/nope'");
    };
    stop(id);
    await settled(id);
    const record = service.latest(id)!;
    expect(record.state).toBe("nogo");
    expect(record.results[0]).toMatchObject({
      verdict: "nogo",
      exitCode: null,
      tail: "EACCES: permission denied, mkdir '/nope'",
    });
  });

  test("a stop while its brief isn't approved runs nothing; a manual run still goes", async () => {
    const { id } = await hireWithChange();
    const other = await hireWithChange(1);
    let planning = true;
    service.planningWith((crewId) => crewId === id && planning);
    expect(await service.run(id, "stop")).toBeNull();
    expect(calls).toEqual([]);
    // Crew without a brief are unaffected.
    expect(await service.run(other.id, "stop")).not.toBeNull();
    await settled(other.id);
    expect(await service.run(id, "manual")).not.toBeNull();
    await settled(id);
    planning = false;
    writeFileSync(join(crew.workdir(id).cwd, "more.txt"), "more");
    expect(await service.run(id, "stop")).not.toBeNull();
  });

  test("stop without changes since the last run does nothing", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    expect(await service.run(id, "stop")).toBeNull();
    expect(service.history(id)).toHaveLength(1);
  });

  test("editing a new, untracked file again counts as a change", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    writeFileSync(join(crew.workdir(id).cwd, "change.txt"), "fixed");
    stop(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(2));
    await settled(id);
  });

  test("a run that crashes part-way is cancelled, not a NO-GO with nothing to show", async () => {
    const { id } = await hireWithChange();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    crash = true;
    stop(id);
    await settled(id);
    expect(service.latest(id)?.state).toBe("cancelled");
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  test("files the checks write themselves don't make the run stale", async () => {
    const { id } = await hireWithChange();
    run = async (opts) => {
      calls.push(opts);
      writeFileSync(join(opts.cwd, "coverage.json"), `{"run":${calls.length}}`);
      return result(opts, "go");
    };
    stop(id);
    await settled(id);
    expect(calls).toHaveLength(2);
    const cwd = crew.workdir(id).cwd;
    expect(launchGuard(service.latest(id), await fingerprint(cwd), true)).toBeNull();
    expect(await service.run(id, "stop")).toBeNull();
    expect(calls).toHaveLength(2);
  });

  test("a manual run goes even without changes", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    const second = await service.run(id, "manual");
    expect(second).toEqual(expect.any(String));
    await settled(id);
    expect(service.history(id).map((r) => [r.id, r.trigger, r.attempt])).toEqual([
      [second, "manual", 1],
      [expect.any(String), "stop", 1],
    ]);
  });

  test("shells and deck-checkout crew are skipped", async () => {
    const shell = await crew.openShell({ deckId: "deck-1", consoleId: 0 });
    const inCheckout = await crew.hire({
      deckId: "deck-1",
      consoleId: 1,
      task: "Fix",
      worktree: false,
    });
    writeFileSync(join(repo, "change.txt"), "new");
    expect(await service.run(shell.id, "stop")).toBeNull();
    expect(await service.run(inCheckout.id, "manual")).toBeNull();
    expect(calls).toEqual([]);
    expect(service.info(inCheckout.id)).toBeUndefined();
  });

  test.each([null, false])("unarmed deck (%s): no run", async (armed) => {
    db.update(decks).set({ checksArmed: armed }).run();
    const { id } = await hireWithChange();
    expect(await service.run(id, "stop")).toBeNull();
    expect(service.latest(id)).toBeNull();
  });

  test("broadcasts a crew.preflight per check, the last one done", async () => {
    const { id } = await hireWithChange();
    verdicts = ["go", "nogo"];
    const preflightId = await service.run(id, "stop");
    await settled(id);
    expect(preflightMsgs()).toEqual([
      {
        type: "crew.preflight",
        deckId: "deck-1",
        crewId: id,
        preflightId,
        check: "check",
        verdict: "go",
        done: false,
      },
      {
        type: "crew.preflight",
        deckId: "deck-1",
        crewId: id,
        preflightId,
        check: "test",
        verdict: "nogo",
        done: true,
      },
    ]);
  });

  test("roster carries the summary", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    expect(crew.member(id).preflight).toEqual({
      state: "go",
      checks: [
        { name: "check", verdict: "go" },
        { name: "test", verdict: "go" },
      ],
      attempt: 1,
      fuel: 3,
      maxFuel: 3,
    });
    const roster = sent.filter((m) => m.type === "crew.roster").at(-1);
    expect(roster?.type === "crew.roster" && roster.crew[0]?.preflight?.state).toBe("go");
  });

  test("a running summary lists the checks still to come", async () => {
    const { id } = await hireWithChange();
    let release!: () => void;
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        release = () => resolve(result(opts, "go"));
      });
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(service.info(id)).toMatchObject({
      state: "running",
      checks: [{ name: "check" }, { name: "test" }],
    });
    release();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(service.info(id)?.checks).toEqual([{ name: "check", verdict: "go" }, { name: "test" }]);
    release();
    await settled(id);
  });

  test("cancel stops a running run", async () => {
    const { id } = await hireWithChange();
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        opts.signal?.addEventListener("abort", () => resolve(result(opts, "skipped")));
      });
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    service.cancel(id);
    expect(service.latest(id)?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(service.latest(id)).toMatchObject({ state: "cancelled", results: [] });
  });

  test("reconcile marks running runs cancelled", async () => {
    const { id } = await hireWithChange();
    db.insert(preflights)
      .values({
        id: "p-stale",
        deckId: "deck-1",
        crewId: id,
        flight: 1,
        attempt: 1,
        state: "running",
        trigger: "stop",
        commit: "abc",
        fingerprint: "def",
        startedAt: Date.now(),
      })
      .run();
    service.reconcile();
    expect(service.latest(id)).toMatchObject({ id: "p-stale", state: "cancelled" });
    expect(service.latest(id)?.finishedAt).toEqual(expect.any(Number));
  });

  test("at most two run at once", async () => {
    const members = [await hireWithChange(0), await hireWithChange(1), await hireWithChange(2)];
    const pending: { cwd: string; release: () => void }[] = [];
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        pending.push({ cwd: opts.cwd, release: () => resolve(result(opts, "go")) });
      });
    const states = () => members.map((m) => service.latest(m.id)?.state ?? null);
    /** Let one crew member's current check finish. */
    const finishCheckOf = async (crewId: string) => {
      const cwd = crew.workdir(crewId).cwd;
      await vi.waitFor(() => expect(pending.some((p) => p.cwd === cwd)).toBe(true));
      pending
        .splice(
          pending.findIndex((p) => p.cwd === cwd),
          1,
        )[0]!
        .release();
    };

    for (const m of members) stop(m.id);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(states()).toEqual(["running", "running", null]);

    await finishCheckOf(members[0]!.id);
    await finishCheckOf(members[0]!.id);
    await vi.waitFor(() => expect(states()).toEqual(["go", "running", "running"]));

    for (const m of members.slice(1)) {
      await finishCheckOf(m.id);
      await finishCheckOf(m.id);
    }
    await vi.waitFor(() => expect(states()).toEqual(["go", "go", "go"]));
  });

  test("deckHistory lists the deck's latest runs, newest first", async () => {
    const a = await hireWithChange(0);
    const b = await hireWithChange(1);
    stop(a.id);
    await settled(a.id);
    stop(b.id);
    await settled(b.id);
    expect(service.deckHistory("deck-1").map((r) => r.crewId)).toEqual([b.id, a.id]);
    expect(service.deckHistory("deck-1", 1)).toHaveLength(1);
  });

  test("arming runs the crew that already stopped", async () => {
    const signal = (crewId: string, type: "stopped" | "working") =>
      crew.handleSignal({ crewId, signal: { type } });
    // Ran once while armed and hasn't changed since: arming doesn't run it again.
    const unchanged = await hireWithChange(0);
    signal(unchanged.id, "stopped");
    stop(unchanged.id);
    await settled(unchanged.id);
    db.update(decks).set({ checksArmed: null }).run();

    const stopped = await hireWithChange(1);
    const working = await hireWithChange(2);
    signal(stopped.id, "stopped");
    signal(working.id, "working");
    stop(stopped.id);
    await new Promise((r) => setTimeout(r, 20));
    expect(service.latest(stopped.id)).toBeNull();

    await service.arm("deck-1");
    expect(checks.armed("deck-1")).toBe(true);
    await settled(stopped.id);
    expect(service.latest(stopped.id)).toMatchObject({ trigger: "stop", state: "go" });
    expect(service.latest(working.id)).toBeNull();
    expect(service.history(unchanged.id)).toHaveLength(1);
  });

  test("arming runs crew waiting on you too, not those working or asleep", async () => {
    db.update(decks).set({ checksArmed: null }).run();
    const waiting = await hireWithChange(0);
    const idle = await hireWithChange(1);
    const asleep = await hireWithChange(2);
    crew.handleSignal({
      crewId: waiting.id,
      signal: { type: "needsInput", detail: "Claude is waiting for your input", idle: true },
    });
    crew.handleSignal({ crewId: idle.id, signal: { type: "idle" } });
    crew.handleExit(asleep.id);

    await service.arm("deck-1");
    await settled(waiting.id);
    await settled(idle.id);
    expect(service.latest(waiting.id)).toMatchObject({ trigger: "stop", state: "go" });
    expect(service.latest(idle.id)).toMatchObject({ trigger: "stop", state: "go" });
    expect(service.latest(asleep.id)).toBeNull();
  });

  test("arming skips crew at a permission prompt or still starting", async () => {
    db.update(decks).set({ checksArmed: null }).run();
    const permission = await hireWithChange(0);
    const idleWait = await hireWithChange(1);
    const starting = await hireWithChange(2);
    crew.handleSignal({
      crewId: permission.id,
      signal: { type: "needsInput", detail: "Approve Bash: rm -rf dist" },
    });
    crew.handleSignal({
      crewId: idleWait.id,
      signal: { type: "needsInput", detail: "Claude is waiting for your input", idle: true },
    });
    expect(crew.member(starting.id).status).toBe("starting");

    await service.arm("deck-1");
    await settled(idleWait.id);
    expect(service.latest(idleWait.id)).toMatchObject({ trigger: "stop", state: "go" });
    expect(service.latest(permission.id)).toBeNull();
    expect(service.latest(starting.id)).toBeNull();
  });

  test("a NO-GO is never typed into a permission prompt", async () => {
    const { id } = await hireWithChange();
    let release!: () => void;
    run = async (opts) => {
      calls.push(opts);
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
      return result(opts, calls.length === 1 ? "go" : "nogo");
    };
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    // A permission request comes up while the checks run.
    crew.handleSignal({ crewId: id, signal: { type: "needsInput", detail: "Approve Bash: ls" } });
    release();
    await settled(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(pastes()).toEqual([]);
    expect(fuelOf(id)?.fuel).toBe(3);
    expect(crew.member(id)).toMatchObject({ status: "needs_input", detail: "Approve Bash: ls" });
  });

  /** Each run's checks wait here until released, or resolve as skipped when aborted. */
  function holdChecks() {
    const held: (() => void)[] = [];
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        held.push(() => resolve(result(opts, "go")));
        opts.signal?.addEventListener("abort", () => resolve(result(opts, "skipped")));
      });
    return held;
  }

  const fuelOf = (crewId: string) =>
    db.select().from(crewTable).where(eq(crewTable.id, crewId)).get();

  const pastes = () => launcher.writes.filter(([, data]) => data.startsWith("\x1b[200~"));

  test("NO-GO types the hand-back and spends fuel", async () => {
    const { id } = await hireWithChange();
    verdicts = ["go", "nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(pastes()).toHaveLength(1));
    const [crewId, data] = pastes()[0]!;
    expect(crewId).toBe(id);
    expect(data).toContain("Pre-flight NO-GO (attempt 2 of 4)");
    expect(data).toContain("✗ test  (`vp test`, exit 1, 0.0s)\nran vp test");
    expect(data).not.toContain("✗ check");
    await vi.waitFor(() => expect(service.info(id)?.fuel).toBe(2));
    expect(service.info(id)).toMatchObject({ state: "nogo", attempt: 1, maxFuel: 3 });
  });

  test("GO types nothing and spends no fuel", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(launcher.writes).toEqual([]);
    expect(service.info(id)?.fuel).toBe(3);
  });

  test("fourth NO-GO raises needs you", async () => {
    const { id } = await hireWithChange();
    for (let attempt = 1; attempt <= 4; attempt++) {
      verdicts = ["go", "nogo"];
      writeFileSync(join(crew.workdir(id).cwd, "change.txt"), `try ${attempt}`);
      stop(id);
      await vi.waitFor(() => expect(service.history(id)).toHaveLength(attempt));
      await settled(id);
      await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(Math.max(0, 3 - attempt)));
      if (attempt < 4) await vi.waitFor(() => expect(pastes()).toHaveLength(attempt));
    }
    await vi.waitFor(() => expect(crew.member(id).status).toBe("needs_input"));
    expect(crew.member(id).detail).toBe("Out of fuel: test still NO-GO after 4 attempts");
    expect(pastes()).toHaveLength(3);
    expect(pastes().map(([, d]) => d.match(/attempt \d of \d/)?.[0])).toEqual([
      "attempt 2 of 4",
      "attempt 3 of 4",
      "attempt 4 of 4",
    ]);
  });

  test("your prompt refuels", async () => {
    const { id } = await hireWithChange();
    verdicts = ["nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(service.info(id)?.fuel).toBe(2));
    await crew.prompt(id, "try again");
    expect(fuelOf(id)?.fuel).toBe(3);
    expect(fuelOf(id)?.flight).toBe(2);
    expect(service.info(id)).toBeUndefined();
  });

  /** Both listeners, in the station's order: the crew's status, then pre-flight. */
  const signal = (crewId: string, sig: Parameters<CrewService["handleSignal"]>[0]["signal"]) => {
    crew.handleSignal({ crewId, signal: sig });
    service.handleSignal({ crewId, missionId: crewId, signal: sig });
  };

  test("a prompt typed in the terminal refuels and starts a new flight", async () => {
    const { id } = await hireWithChange();
    verdicts = ["nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(2));
    // The station's hand-back is submitted: its hook is not your prompt.
    signal(id, { type: "working" });
    expect(fuelOf(id)).toMatchObject({ flight: 1, fuel: 2 });
    // Then you type in its terminal.
    signal(id, { type: "working" });
    expect(fuelOf(id)).toMatchObject({ flight: 2, fuel: 3 });
    expect(service.info(id)).toBeUndefined();
  });

  test("busy while a pre-flight runs, and while a hand-back is coming", async () => {
    const { id } = await hireWithChange();
    const signalAll = (sig: Parameters<CrewService["handleSignal"]>[0]["signal"]) => {
      crew.handleSignal({ crewId: id, signal: sig });
      service.handleSignal({ crewId: id, missionId: id, signal: sig });
    };
    expect(service.busy(id)).toBe(false);
    const held = holdChecks();
    signalAll({ type: "stopped" });
    expect(service.busy(id)).toBe(true);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(service.busy(id)).toBe(true);
    held.shift()!();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    held.shift()!();
    await settled(id);
    // GO: through.
    await vi.waitFor(() => expect(service.busy(id)).toBe(false));

    // A NO-GO with fuel left: the hand-back is typed, and it's busy until it stops with a GO.
    run = async (opts) => {
      calls.push(opts);
      return result(opts, verdicts.shift() ?? "go");
    };
    verdicts = ["go", "nogo"];
    writeFileSync(join(crew.workdir(id).cwd, "change.txt"), "broken");
    signalAll({ type: "stopped" });
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(2));
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(2));
    expect(crew.member(id).status).toBe("done");
    expect(service.busy(id)).toBe(true);
    // Asleep, nothing is coming.
    crew.handleExit(id);
    expect(service.busy(id)).toBe(false);
  });

  test.each(["disarmed", "no checks"])(
    "not busy after a NO-GO once the deck is %s",
    async (how) => {
      const { id } = await hireWithChange();
      verdicts = ["nogo", "nogo"];
      crew.handleSignal({ crewId: id, signal: { type: "stopped" } });
      stop(id);
      await settled(id);
      await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(2));
      expect(service.busy(id)).toBe(true);
      if (how === "disarmed") checks.arm("deck-1", false);
      else db.update(deckChecks).set({ enabled: false }).run();
      expect(service.busy(id)).toBe(false);
    },
  );

  test("not busy once out of fuel: it needs you", async () => {
    const { id } = await hireWithChange();
    db.update(crewTable).set({ fuel: 0 }).where(eq(crewTable.id, id)).run();
    verdicts = ["nogo", "nogo"];
    crew.handleSignal({ crewId: id, signal: { type: "stopped" } });
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(crew.member(id).status).toBe("needs_input"));
    expect(service.busy(id)).toBe(false);
  });

  test("stopping again without changes after a NO-GO raises needs you, spending nothing", async () => {
    const { id } = await hireWithChange();
    verdicts = ["nogo", "nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(2));
    expect(await service.run(id, "stop")).toBeNull();
    expect(crew.member(id)).toMatchObject({
      status: "needs_input",
      detail: `check, test still NO-GO; ${crew.member(id).name} stopped without changes`,
    });
    expect(service.history(id)).toHaveLength(1);
    expect(fuelOf(id)?.fuel).toBe(2);
    expect(pastes()).toHaveLength(1);
  });

  test("a manual run alone in a flight shows in info()", async () => {
    const { id } = await hireWithChange();
    verdicts = ["go", "go"];
    await service.run(id, "manual");
    await settled(id);
    expect(service.info(id)).toMatchObject({ state: "go", attempt: 0 });
  });

  test("the station's own hand-back doesn't refuel", async () => {
    const { id } = await hireWithChange();
    await crew.prompt(id, "fix it", "station");
    expect(fuelOf(id)).toMatchObject({ flight: 1, fuel: 3 });
  });

  test("a second stop during a run doesn't start another", async () => {
    const { id } = await hireWithChange();
    const held = holdChecks();
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    writeFileSync(join(crew.workdir(id).cwd, "change.txt"), "more");
    expect(await service.run(id, "stop")).toBeNull();
    stop(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    held.shift()!();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    held.shift()!();
    await settled(id);
    expect(service.history(id)).toHaveLength(1);
  });

  test("working mid-run cancels without spending fuel", async () => {
    const { id } = await hireWithChange();
    holdChecks();
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    service.handleSignal({ crewId: id, missionId: id, signal: { type: "working" } });
    expect(service.latest(id)?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(service.info(id)?.fuel).toBe(3);
    expect(launcher.writes).toEqual([]);
  });

  test("your prompt mid-run cancels without spending fuel", async () => {
    const { id } = await hireWithChange();
    holdChecks();
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await crew.prompt(id, "actually, do this");
    expect(service.latest(id)?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(fuelOf(id)?.fuel).toBe(3);
    expect(pastes()).toHaveLength(1);
  });

  test("send home mid-run cancels without spending fuel", async () => {
    const { id } = await hireWithChange();
    holdChecks();
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await crew.sendHome(id, "remove");
    expect(service.latest(id)?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(service.info(id)?.fuel).toBe(3);
    expect(launcher.writes).toEqual([]);
  });

  test("a worktree gone mid-run cancels without a hand-back", async () => {
    const { id } = await hireWithChange();
    const held = holdChecks();
    verdicts = ["nogo", "nogo"];
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    rmSync(crew.workdir(id).cwd, { recursive: true, force: true });
    held.shift()!();
    await vi.waitFor(() => expect(service.latest(id)?.state).toBe("cancelled"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(fuelOf(id)?.fuel).toBe(3);
    expect(launcher.writes).toEqual([]);
  });

  test("no checks, no pre-flight", async () => {
    db.update(deckChecks).set({ enabled: false }).run();
    const { id } = await hireWithChange();
    expect(await service.run(id, "stop")).toBeNull();
    expect(await service.run(id, "manual")).toBeNull();
    expect(service.info(id)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  test("agent exit mid-run cancels", async () => {
    const { id } = await hireWithChange();
    holdChecks();
    stop(id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    service.cancel(id);
    expect(service.latest(id)?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 20));
    expect(launcher.writes).toEqual([]);
    expect(service.info(id)?.fuel).toBe(3);
  });

  test("a manual run NO-GO spends no fuel and types nothing", async () => {
    const { id } = await hireWithChange();
    verdicts = ["nogo", "nogo"];
    await service.run(id, "manual");
    await settled(id);
    await new Promise((r) => setTimeout(r, 20));
    expect(service.latest(id)?.state).toBe("nogo");
    expect(launcher.writes).toEqual([]);
    expect(service.info(id)?.fuel).toBe(3);
  });

  test("a failed hand-back write is treated as out of fuel", async () => {
    const { id } = await hireWithChange();
    launcher.fail = true;
    verdicts = ["go", "nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(crew.member(id).status).toBe("needs_input"));
    expect(crew.member(id).detail).toBe(
      "Out of fuel: test still NO-GO after 1 attempts (couldn't reach the agent)",
    );
    expect(fuelOf(id)?.fuel).toBe(3);
  });

  test("manual runs don't count toward a flight's attempts", async () => {
    const { id } = await hireWithChange();
    verdicts = ["nogo", "nogo"];
    stop(id);
    await settled(id);
    await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(2));

    verdicts = ["nogo", "nogo"];
    await service.run(id, "manual");
    await settled(id);
    expect(service.info(id)).toMatchObject({ attempt: 1, fuel: 2 });

    verdicts = ["nogo", "nogo"];
    writeFileSync(join(crew.workdir(id).cwd, "change.txt"), "again");
    stop(id);
    await vi.waitFor(() => expect(service.history(id)).toHaveLength(3));
    await settled(id);
    await vi.waitFor(() => expect(pastes()).toHaveLength(2));
    expect(pastes()[1]![1]).toContain("Pre-flight NO-GO (attempt 3 of 4)");
    await vi.waitFor(() => expect(fuelOf(id)?.fuel).toBe(1));
    expect(service.info(id)?.attempt).toBe(2);
    expect(service.history(id).map((r) => [r.trigger, r.attempt])).toEqual([
      ["stop", 2],
      ["manual", 1],
      ["stop", 1],
    ]);
  });
});
