import type { Mission } from "@mothership/mission-engine";
import type { ServerMsg } from "@mothership/protocol";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CrewLauncher, LaunchRequest } from "../../src/features/crew/launcher.server.ts";
import { createMissionRecord, loadMission } from "../../src/features/missions/repo.server.ts";
import {
  MissionRuntime,
  crewIdFor,
  eventsForSignal,
} from "../../src/features/missions/runtime.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

class FakeLauncher implements CrewLauncher {
  launches: LaunchRequest[] = [];
  writes: { crewId: string; data: string }[] = [];
  failWith: Error | null = null;
  async launch(request: LaunchRequest) {
    if (this.failWith) throw this.failWith;
    this.launches.push(request);
  }
  async write(crewId: string, data: string) {
    this.writes.push({ crewId, data });
  }
}

let scratch: string;
let db: Db;
let launcher: FakeLauncher;
let broadcasts: ServerMsg[];
let runtime: MissionRuntime;
let missionId: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-rt-")));
  const repo = join(scratch, "shop");
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

  db = createDb(":memory:", { migrationsFolder });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  missionId = createMissionRecord(db, {
    deckId: "deck-1",
    goal: "Add dark mode",
    criteria: [{ kind: "command", command: "vp test" }],
  });
  launcher = new FakeLauncher();
  broadcasts = [];
  runtime = new MissionRuntime({
    db,
    launcher,
    broadcast: (msg) => broadcasts.push(msg),
    home: join(scratch, "home"),
  });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const state = () => loadMission(db, missionId).mission.state;

describe("launching", () => {
  test("launchCrew creates a worktree, saves it and launches the Engineer with the brief", async () => {
    const result = await runtime.dispatch(missionId, { type: "launchCrew" });
    expect(result.ok).toBe(true);

    const record = loadMission(db, missionId);
    expect(record.mission.state).toBe("building");
    expect(record.branch).toMatch(/^mothership\/add-dark-mode-/);
    expect(record.worktreePath).toBe(
      join(scratch, "home", "worktrees", "shop-deck-1", missionId.slice(0, 8)),
    );
    expect(existsSync(join(record.worktreePath!, "README.md"))).toBe(true);

    expect(launcher.launches).toEqual([
      {
        crewId: crewIdFor(missionId),
        missionId,
        provider: "claude-code",
        cwd: record.worktreePath,
        prompt: expect.stringContaining("Mission: Add dark mode"),
      },
    ]);
  });

  test("broadcasts the updated mission", async () => {
    await runtime.dispatch(missionId, { type: "launchCrew" });
    expect(broadcasts).toContainEqual({
      type: "mission.updated",
      missionId,
      deckId: "deck-1",
      mission: expect.objectContaining({ state: "building", attempts: 1 }),
    });
  });

  test("a failed launch raises a red alert instead of leaving the mission building", async () => {
    launcher.failWith = new Error("Command not found: claude");
    await runtime.dispatch(missionId, { type: "launchCrew" });
    const { mission } = loadMission(db, missionId);
    expect(mission.state).toBe("redAlert");
    expect(mission.alert).toEqual({ reason: "crashed", detail: "Command not found: claude" });
  });

  test("invalid transitions are reported and change nothing", async () => {
    const result = await runtime.dispatch(missionId, { type: "crewStopped" });
    expect(result).toEqual({ ok: false, error: "Cannot crewStopped while briefing" });
    expect(state()).toBe("briefing");
    expect(broadcasts).toEqual([]);
  });
});

describe("crew signals", () => {
  beforeEach(async () => {
    await runtime.dispatch(missionId, { type: "launchCrew" });
  });

  const signal = (s: Parameters<MissionRuntime["handleSignal"]>[0]["signal"]) =>
    runtime.handleSignal({ crewId: crewIdFor(missionId), missionId, signal: s });

  test("needs input → red alert, then working again → resume", async () => {
    await signal({ type: "needsInput", detail: "Approve Bash: rm -rf dist" });
    expect(loadMission(db, missionId).mission.alert).toEqual({
      reason: "needsInput",
      detail: "Approve Bash: rm -rf dist",
    });
    await signal({ type: "working", activity: { tool: "Bash", command: "rm -rf dist" } });
    expect(state()).toBe("building");
  });

  test("stopped → pre-flight and the runPreflight effect runs", async () => {
    const ran: string[] = [];
    runtime.setEffect("runPreflight", async (ctx) => {
      ran.push(ctx.missionId);
    });
    await signal({ type: "stopped" });
    expect(state()).toBe("preflight");
    expect(ran).toEqual([missionId]);
  });

  test("a session ending mid-build is a crash", async () => {
    await signal({ type: "ended", reason: "prompt_input_exit" });
    expect(loadMission(db, missionId).mission.alert).toEqual({
      reason: "crashed",
      detail: "Crew session ended (prompt_input_exit)",
    });
  });

  test("the crew process exiting mid-build is a crash", async () => {
    await runtime.handleCrewExit(crewIdFor(missionId), 137);
    expect(loadMission(db, missionId).mission.alert).toEqual({
      reason: "crashed",
      detail: "Crew process exited with code 137",
    });
  });

  test("signals that don't apply are ignored", async () => {
    await signal({ type: "working" });
    await signal({ type: "idle" });
    expect(state()).toBe("building");
  });

  test("concurrent signals are applied in order", async () => {
    await Promise.all([
      signal({ type: "needsInput", detail: "?" }),
      signal({ type: "working" }),
      signal({ type: "stopped" }),
    ]);
    expect(state()).toBe("preflight");
  });
});

describe("reconcile", () => {
  test("missions still building without a live crew session crash on startup", async () => {
    await runtime.dispatch(missionId, { type: "launchCrew" });
    await runtime.reconcile([]);
    expect(loadMission(db, missionId).mission.alert).toEqual({
      reason: "crashed",
      detail: "Crew session was lost while the station was down",
    });
  });

  test("missions with an exited session report its exit code", async () => {
    await runtime.dispatch(missionId, { type: "launchCrew" });
    await runtime.reconcile([{ id: crewIdFor(missionId), exited: true, exitCode: 1 }]);
    expect(loadMission(db, missionId).mission.alert?.detail).toBe(
      "Crew process exited with code 1",
    );
  });

  test("missions with a live session are left alone", async () => {
    await runtime.dispatch(missionId, { type: "launchCrew" });
    await runtime.reconcile([{ id: crewIdFor(missionId), exited: false }]);
    expect(state()).toBe("building");
  });
});

describe("eventsForSignal", () => {
  const base: Mission = {
    state: "building",
    brief: { goal: "g", criteria: [] },
    attempts: 1,
    maxAttempts: 3,
  };
  const needsInput: Mission = {
    ...base,
    state: "redAlert",
    alert: { reason: "needsInput", detail: "?" },
    resumeTo: "building",
  };
  const crashed: Mission = { ...needsInput, alert: { reason: "crashed", detail: "x" } };

  test.each<[string, Mission, Parameters<typeof eventsForSignal>[0], string[]]>([
    ["needsInput while building", base, { type: "needsInput", detail: "?" }, ["crewNeedsInput"]],
    ["needsInput while already alerted", needsInput, { type: "needsInput", detail: "?" }, []],
    ["working after needing input", needsInput, { type: "working" }, ["resume"]],
    ["working after a crash", crashed, { type: "working" }, []],
    ["stopped while building", base, { type: "stopped" }, ["crewStopped"]],
    ["stopped after needing input", needsInput, { type: "stopped" }, ["resume", "crewStopped"]],
    ["stopped in pre-flight", { ...base, state: "preflight" }, { type: "stopped" }, []],
    ["ended while building", base, { type: "ended", reason: "other" }, ["crewCrashed"]],
    ["idle", base, { type: "idle" }, []],
  ])("%s", (_, mission, s, expected) => {
    expect(eventsForSignal(s, mission).map((e) => e.type)).toEqual(expected);
  });
});
