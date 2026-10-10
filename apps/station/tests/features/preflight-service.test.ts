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
import { PreflightService } from "../../src/features/preflight/preflight.server.ts";
import type { CheckRun, RunCheck } from "../../src/features/preflight/runner.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { deckChecks, decks, preflights } from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  writes: [string, string][] = [];
  async launch() {}
  async write(crewId: string, data: string) {
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
let crew: CrewService;
let checks: CheckService;
let calls: RunOpts[];
let verdicts: CheckRun["verdict"][];
let run: RunCheck;
let service: PreflightService;

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
  const broadcast = (msg: ServerMsg) => void sent.push(msg);
  crew = new CrewService({ db, launcher: new FakeLauncher(), broadcast, home });
  checks = new CheckService({ db, broadcast });
  checks.arm("deck-1", true);
  calls = [];
  verdicts = [];
  run = async (opts) => {
    calls.push(opts);
    return result(opts, verdicts.shift() ?? "go");
  };
  service = new PreflightService({ db, crew, checks, broadcast, home, run: (o) => run(o) });
  crew.describeWith((id) => service.info(id));
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
        tail: "ran vp check\n",
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

  test("a manual run goes even without changes", async () => {
    const { id } = await hireWithChange();
    stop(id);
    await settled(id);
    const second = await service.run(id, "manual");
    expect(second).toEqual(expect.any(String));
    await settled(id);
    expect(service.history(id).map((r) => [r.id, r.trigger, r.attempt])).toEqual([
      [second, "manual", 2],
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
});
