import type { ServerMsg } from "@mothership/protocol";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { BRIEF_INSTRUCTIONS } from "../../src/features/briefs/model.ts";
import { lessonsPrompt } from "../../src/features/debrief/model.ts";
import type { CrewLauncher, LaunchRequest } from "../../src/features/crew/launcher.server.ts";
import { parseHireInput, parsePromptInput } from "../../src/features/crew/model.ts";
import { CrewService, type MissionEnd } from "../../src/features/crew/service.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { eq } from "drizzle-orm";
import { crew as crewTable, decks } from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  launches: LaunchRequest[] = [];
  writes: [string, string][] = [];
  failWith: Error | null = null;
  async launch(r: LaunchRequest) {
    if (this.failWith) throw this.failWith;
    this.launches.push(r);
  }
  async write(crewId: string, data: string) {
    this.writes.push([crewId, data]);
  }
  stopped: string[] = [];
  async stop(crewId: string) {
    this.stopped.push(crewId);
  }
}

let scratch: string;
let repo: string;
let db: Db;
let launcher: FakeLauncher;
let rosters: Extract<ServerMsg, { type: "crew.roster" }>[];
let service: CrewService;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-crew-")));
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
  launcher = new FakeLauncher();
  rosters = [];
  service = new CrewService({
    db,
    launcher,
    home: join(scratch, "home"),
    broadcast: (msg) => msg.type === "crew.roster" && rosters.push(msg),
  });
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const hire = (consoleId: number, task = "Add dark mode", worktree = false) =>
  service.hire({ deckId: "deck-1", consoleId, task, worktree });

describe("hire", () => {
  test("seats a starting crew member at the console and launches it in the repo", async () => {
    const nova = await hire(3);
    expect(nova).toMatchObject({
      deckId: "deck-1",
      consoleId: 3,
      name: "Nova",
      task: "Add dark mode",
      status: "starting",
    });
    expect(launcher.launches).toEqual([
      {
        crewId: nova.id,
        missionId: nova.id,
        provider: "claude-code",
        prompt: "Add dark mode",
        cwd: repo,
        plan: { instructions: BRIEF_INSTRUCTIONS },
      },
    ]);
    expect(nova.kind).toBe("agent");
    expect(rosters.at(-1)?.crew.map((c) => c.name)).toEqual(["Nova"]);
  });

  test("names are handed out in order and reused per deck", async () => {
    expect((await hire(0)).name).toBe("Nova");
    expect((await hire(1)).name).toBe("Comet");
  });

  test("with a worktree, works on its own branch", async () => {
    const nova = await hire(2, "Add dark mode", true);
    expect(nova.branch).toMatch(/^mothership\/add-dark-mode-/);
    expect(launcher.launches[0]!.cwd).toContain(join(scratch, "home", "worktrees"));
  });

  test("a taken console can't be hired twice", async () => {
    await hire(5);
    await expect(hire(5)).rejects.toThrow("Console 6 is taken");
  });

  test("a failed launch frees the console again", async () => {
    launcher.failWith = new Error("Command not found: claude");
    await expect(hire(1)).rejects.toThrow("Command not found: claude");
    expect(service.roster("deck-1")).toEqual([]);
  });

  test("an unknown deck is rejected", async () => {
    await expect(
      service.hire({ deckId: "nope", consoleId: 0, task: "", worktree: false }),
    ).rejects.toThrow("No such deck");
  });
});

describe("signals", () => {
  test("hooks drive status, action and detail like agent-office", async () => {
    const { id } = await hire(0);
    const status = () => service.roster("deck-1")[0]!;

    service.handleSignal({ crewId: id, signal: { type: "idle" } });
    expect(status().status).toBe("idle");

    service.handleSignal({
      crewId: id,
      signal: { type: "working", activity: { tool: "Edit", filePath: "/a.ts" } },
    });
    expect(status()).toMatchObject({ status: "working", action: "edit" });

    service.handleSignal({
      crewId: id,
      signal: { type: "working", activity: { tool: "Bash", command: "vp test" } },
    });
    expect(status().action).toBe("test");

    service.handleSignal({
      crewId: id,
      signal: { type: "needsInput", detail: "Approve Bash: rm -rf dist" },
    });
    expect(status()).toMatchObject({ status: "needs_input", detail: "Approve Bash: rm -rf dist" });
    expect(status().action).toBeUndefined();

    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    expect(status()).toMatchObject({ status: "done" });
    expect(status().detail).toBeUndefined();

    service.handleSignal({ crewId: id, signal: { type: "ended", reason: "other" } });
    expect(status().status).toBe("asleep");
  });

  test("statusSince only moves when the status changes", async () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      const { id } = await hire(0);
      vi.setSystemTime(5_000);
      service.handleSignal({ crewId: id, signal: { type: "working" } });
      vi.setSystemTime(9_000);
      service.handleSignal({ crewId: id, signal: { type: "working", activity: { tool: "Read" } } });
      expect(service.roster("deck-1")[0]!.statusSince).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a crew process exiting puts it to sleep", async () => {
    const { id } = await hire(0);
    service.handleExit(id);
    expect(service.roster("deck-1")[0]!.status).toBe("asleep");
  });

  test("signals for unknown crew are ignored", () => {
    expect(() => service.handleSignal({ crewId: "ghost", signal: { type: "idle" } })).not.toThrow();
  });

  test("reconcile puts crew whose session is gone to sleep", async () => {
    const a = await hire(0);
    const b = await hire(1);
    service.reconcile([{ id: b.id, exited: false }]);
    const byId = Object.fromEntries(service.roster("deck-1").map((c) => [c.id, c.status]));
    expect(byId).toEqual({ [a.id]: "asleep", [b.id]: "starting" });
  });
});

describe("prompt", () => {
  test("pastes the text, then presses Enter", async () => {
    vi.useFakeTimers();
    try {
      const { id } = await hire(0);
      await service.prompt(id, "Also add tests");
      expect(launcher.writes).toEqual([[id, "\x1b[200~Also add tests\x1b[201~"]]);
      await vi.advanceTimersByTimeAsync(150);
      expect(launcher.writes.at(-1)).toEqual([id, "\r"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("unknown crew can't be prompted", async () => {
    await expect(service.prompt("ghost", "hi")).rejects.toThrow("No such crew member");
  });

  test("tells listeners who typed it, you by default", async () => {
    const { id } = await hire(0);
    const heard: { crewId: string; from: string }[] = [];
    const off = service.onPrompt((e) => heard.push(e));
    await service.prompt(id, "Also add tests");
    await service.prompt(id, "Pre-flight NO-GO", "station");
    off();
    await service.prompt(id, "Unheard");
    expect(heard).toEqual([
      { crewId: id, from: "you" },
      { crewId: id, from: "station" },
    ]);
  });

  test("a prompt typed in the terminal counts as yours", async () => {
    const { id } = await hire(0);
    const heard: { crewId: string; from: string }[] = [];
    service.onPrompt((e) => heard.push(e));
    // UserPromptSubmit: working with no tool.
    service.handleSignal({ crewId: id, signal: { type: "working" } });
    // PreToolUse: working with a tool, not a prompt.
    service.handleSignal({ crewId: id, signal: { type: "working", activity: { tool: "Read" } } });
    expect(heard).toEqual([{ crewId: id, from: "you" }]);
  });

  test("the submit after a station or app prompt isn't heard twice", async () => {
    const { id } = await hire(0);
    const heard: { crewId: string; from: string }[] = [];
    service.onPrompt((e) => heard.push(e));
    await service.prompt(id, "Pre-flight NO-GO", "station");
    service.handleSignal({ crewId: id, signal: { type: "working" } });
    await service.prompt(id, "Also add tests");
    service.handleSignal({ crewId: id, signal: { type: "working" } });
    expect(heard).toEqual([
      { crewId: id, from: "station" },
      { crewId: id, from: "you" },
    ]);
    // The next one typed in the terminal is yours again.
    service.handleSignal({ crewId: id, signal: { type: "working" } });
    expect(heard.at(-1)).toEqual({ crewId: id, from: "you" });
    expect(heard).toHaveLength(3);
  });

  test("a failed write tells nobody", async () => {
    const { id } = await hire(0);
    const heard: unknown[] = [];
    service.onPrompt((e) => heard.push(e));
    launcher.write = async () => {
      throw new Error("PTY gone");
    };
    await expect(service.prompt(id, "hi")).rejects.toThrow("PTY gone");
    expect(heard).toEqual([]);
  });
});

describe("pre-flight hooks", () => {
  test("describeWith adds a pre-flight summary to the roster", async () => {
    const { id } = await hire(0);
    const preflight = {
      state: "go" as const,
      checks: [{ name: "test", verdict: "go" as const }],
      attempt: 1,
      fuel: 3,
      maxFuel: 3,
    };
    service.describeWith((crewId) => (crewId === id ? { preflight } : {}));
    expect(service.member(id).preflight).toEqual(preflight);
    expect(service.roster("deck-1")[0]!.preflight).toEqual(preflight);
  });

  test("refresh re-broadcasts the roster", async () => {
    await hire(0);
    const before = rosters.length;
    service.refresh("deck-1");
    expect(rosters).toHaveLength(before + 1);
  });

  test("alert raises needs you with the detail", async () => {
    const { id } = await hire(0);
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    service.alert(id, "Out of fuel: test still NO-GO after 4 attempts");
    expect(service.member(id)).toMatchObject({
      status: "needs_input",
      detail: "Out of fuel: test still NO-GO after 4 attempts",
    });
  });
});

describe("idle notifications", () => {
  const idle = {
    type: "needsInput",
    detail: "Claude is waiting for your input",
    idle: true,
  } as const;

  test("an idle notification raises needs you when nothing else is going on", async () => {
    const { id } = await hire(0);
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    service.handleSignal({ crewId: id, signal: idle });
    expect(service.member(id)).toMatchObject({ status: "needs_input", detail: idle.detail });
  });

  test("ignored while a pre-flight is busy with the crew member", async () => {
    const { id } = await hire(0);
    let busy = true;
    service.busyWith((crewId) => crewId === id && busy);
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    service.handleSignal({ crewId: id, signal: idle });
    expect(service.member(id).status).toBe("done");
    busy = false;
    service.handleSignal({ crewId: id, signal: idle });
    expect(service.member(id).status).toBe("needs_input");
  });

  test("a station alert stands until the crew member works again", async () => {
    const { id } = await hire(0);
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    service.alert(id, "Out of fuel: test still NO-GO after 4 attempts");
    service.handleSignal({ crewId: id, signal: idle });
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    expect(service.member(id)).toMatchObject({
      status: "needs_input",
      detail: "Out of fuel: test still NO-GO after 4 attempts",
    });
    service.handleSignal({ crewId: id, signal: { type: "working" } });
    expect(service.member(id).status).toBe("working");
    expect(service.member(id).detail).toBeUndefined();
    service.handleSignal({ crewId: id, signal: { type: "stopped" } });
    service.handleSignal({ crewId: id, signal: idle });
    expect(service.member(id)).toMatchObject({ status: "needs_input", detail: idle.detail });
  });
});

describe("a brief waiting", () => {
  test("your prompts are refused while it waits; the station's still go through", async () => {
    const { id } = await hire(0);
    let waiting = true;
    service.briefWaitingWith((crewId) => crewId === id && waiting);
    await expect(service.prompt(id, "Also add tests")).rejects.toThrow(
      "Nova has a brief waiting: Y to approve, N to revise",
    );
    expect(launcher.writes).toEqual([]);
    await service.prompt(id, "Keep the light theme too", "station");
    expect(launcher.writes).toEqual([[id, "\x1b[200~Keep the light theme too\x1b[201~"]]);
    waiting = false;
    await service.prompt(id, "Also add tests");
    expect(launcher.writes.at(-1)).toEqual([id, "\x1b[200~Also add tests\x1b[201~"]);
  });

  test("a later needs-you keeps Brief ready", async () => {
    const { id } = await hire(0);
    service.briefWaitingWith((crewId) => crewId === id);
    service.handleSignal({ crewId: id, signal: { type: "plan", plan: "## Goal\nX." } });
    service.handleSignal({
      crewId: id,
      signal: { type: "needsInput", detail: "Claude needs your permission to use ExitPlanMode" },
    });
    expect(service.member(id)).toMatchObject({ status: "needs_input", detail: "Brief ready" });
    service.handleSignal({
      crewId: id,
      signal: { type: "needsInput", detail: "Claude is waiting for your input", idle: true },
    });
    expect(service.member(id)).toMatchObject({ status: "needs_input", detail: "Brief ready" });
    // Not Claude idling at its prompt: nothing may be typed there.
    expect(service.waitingIdle(id)).toBe(false);
  });

  test("resume relaunches in plan mode until a brief is approved", async () => {
    const nova = await hire(1);
    let approved = false;
    service.briefUnapprovedWith((crewId) => crewId === nova.id && !approved);
    service.handleSignal({ crewId: nova.id, signal: { type: "idle" }, sessionId: "sess-1" });
    service.handleExit(nova.id);
    await service.resume(nova.id);
    expect(launcher.launches.at(-1)).toMatchObject({
      resume: "sess-1",
      plan: { instructions: BRIEF_INSTRUCTIONS },
    });
    service.handleExit(nova.id);
    approved = true;
    await service.resume(nova.id);
    expect(launcher.launches.at(-1)).toMatchObject({ resume: "sess-1" });
    expect(launcher.launches.at(-1)).not.toHaveProperty("plan");
  });

  test("resume never plans without a brief (hired before briefs), as before", async () => {
    const nova = await hire(1);
    service.handleExit(nova.id);
    await service.resume(nova.id);
    expect(launcher.launches.at(-1)).not.toHaveProperty("plan");
  });

  test("resume never plans without a task, or for a shell", async () => {
    service.briefUnapprovedWith(() => true);
    const blank = await hire(1, "  ");
    service.handleExit(blank.id);
    await service.resume(blank.id);
    expect(launcher.launches.at(-1)).not.toHaveProperty("plan");
    const shell = await service.openShell({ deckId: "deck-1", consoleId: 6 });
    service.handleExit(shell.id);
    await service.resume(shell.id);
    expect(launcher.launches.at(-1)).not.toHaveProperty("plan");
  });

  test("exit listeners hear a crew process exit", async () => {
    const { id } = await hire(0);
    const heard: string[] = [];
    service.onExit((crewId) => heard.push(crewId));
    service.handleExit(id);
    expect(heard).toEqual([id]);
  });
});

describe("input parsing", () => {
  test("hire input", () => {
    expect(parseHireInput({ deckId: "d", consoleId: 4, task: "  go  ", worktree: true })).toEqual({
      deckId: "d",
      consoleId: 4,
      task: "go",
      worktree: true,
    });
    expect(() => parseHireInput({ deckId: "d", consoleId: 16 })).toThrow("consoleId must be 0–15");
  });

  test("prompt input", () => {
    expect(parsePromptInput({ crewId: "c", text: " hi\r\nthere " })).toEqual({
      crewId: "c",
      text: "hi\nthere",
    });
    expect(() => parsePromptInput({ crewId: "c", text: "  " })).toThrow("Empty prompt");
  });
});

describe("send home", () => {
  const branches = () =>
    execFileSync("git", ["-C", repo, "branch", "--format=%(refname:short)"], { encoding: "utf8" });

  test("frees the console and stops the process", async () => {
    const nova = await hire(4);
    const gone: string[] = [];
    service.onGone((id) => gone.push(id));
    await service.sendHome(nova.id, "keep");
    expect(service.roster("deck-1")).toEqual([]);
    expect(rosters.at(-1)?.crew).toEqual([]);
    expect(launcher.stopped).toEqual([nova.id]);
    expect(gone).toEqual([nova.id]);
    expect(await service.worktree(nova.id).catch((e: Error) => e.message)).toMatch("No such");
  });

  test("without its own worktree there's nothing to ask about", async () => {
    const nova = await hire(4);
    expect(await service.worktree(nova.id)).toBeNull();
  });

  test("reports uncommitted and unpushed work in its worktree", async () => {
    const nova = await hire(4, "Add dark mode", true);
    const cwd = launcher.launches[0]!.cwd;
    expect(await service.worktree(nova.id)).toEqual({ missing: false, dirty: 0, unpushed: 0 });
    writeFileSync(join(cwd, "a.txt"), "a");
    execFileSync("git", ["-C", cwd, "add", "."]);
    execFileSync("git", [
      "-C",
      cwd,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "a",
    ]);
    writeFileSync(join(cwd, "b.txt"), "b");
    expect(await service.worktree(nova.id)).toEqual({ missing: false, dirty: 1, unpushed: 1 });
  });

  test("keeps, removes, or removes the worktree and its branch", async () => {
    const keep = await hire(0, "Keep me", true);
    const remove = await hire(1, "Remove me", true);
    const del = await hire(2, "Delete me", true);
    const [keepCwd, removeCwd, delCwd] = launcher.launches.map((l) => l.cwd);
    await service.sendHome(keep.id, "keep");
    await service.sendHome(remove.id, "remove");
    await service.sendHome(del.id, "delete");
    expect(existsSync(keepCwd!)).toBe(true);
    expect(existsSync(removeCwd!)).toBe(false);
    expect(existsSync(delCwd!)).toBe(false);
    expect(branches()).toContain(keep.branch);
    expect(branches()).toContain(remove.branch);
    expect(branches()).not.toContain(del.branch);
  });
});

describe("mission ends", () => {
  const missionSince = (id: string) =>
    db.select().from(crewTable).where(eq(crewTable.id, id)).get()?.missionSince;

  test("hire starts the mission", async () => {
    const before = Date.now();
    const nova = await hire(0);
    expect(missionSince(nova.id)).toBeGreaterThanOrEqual(before);
  });

  test("a pull request ends the mission, then the next one starts", async () => {
    const nova = await hire(0, "Add dark mode", true);
    const since = missionSince(nova.id)!;
    const ends: MissionEnd[] = [];
    service.onMissionEnd((end) => {
      // Listeners read the mission's rows before the next one starts.
      expect(missionSince(nova.id)).toBe(since);
      ends.push(end);
    });
    service.endMission(nova.id, "pr", { url: "https://gh/pr/1", branch: nova.branch! });
    expect(ends).toEqual([
      {
        crewId: nova.id,
        deckId: "deck-1",
        name: "Nova",
        task: "Add dark mode",
        missionSince: since,
        endedAt: expect.any(Number),
        how: "pr",
        prUrl: "https://gh/pr/1",
        branch: nova.branch,
        provider: "claude-code",
        ownWorktree: true,
      },
    ]);
    expect(missionSince(nova.id)).toBe(ends[0]!.endedAt);
  });

  test("send home ends the mission while its row is still there", async () => {
    const nova = await hire(0);
    const ends: { end: MissionEnd; seated: boolean }[] = [];
    service.onMissionEnd((end) => ends.push({ end, seated: !!missionSince(end.crewId) }));
    await service.sendHome(nova.id, "keep");
    expect(ends).toEqual([
      {
        end: expect.objectContaining({ crewId: nova.id, how: "home", ownWorktree: false }),
        seated: true,
      },
    ]);
    expect(ends[0]!.end).not.toHaveProperty("prUrl");
  });

  test("a failing listener doesn't stop the send-home or the others", async () => {
    const nova = await hire(0);
    const heard: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    service.onMissionEnd(() => {
      throw new Error("boom");
    });
    service.onMissionEnd((end) => heard.push(end.how));
    service.endMission(nova.id, "pr", { url: "u", branch: "b" });
    await service.sendHome(nova.id, "keep");
    expect(heard).toEqual(["pr", "home"]);
    expect(service.roster("deck-1")).toEqual([]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  test("an unknown crew member's mission doesn't end", () => {
    const heard: MissionEnd[] = [];
    service.onMissionEnd((end) => heard.push(end));
    service.endMission("nobody", "pr", { url: "u", branch: "b" });
    expect(heard).toEqual([]);
  });
});

describe("shells and resuming", () => {
  test("B opens a ready shell in the deck's checkout", async () => {
    const shell = await service.openShell({ deckId: "deck-1", consoleId: 6 });
    expect(shell).toMatchObject({ kind: "shell", status: "idle", task: "" });
    expect(launcher.launches.at(-1)).toMatchObject({ provider: "shell", cwd: repo, prompt: "" });
  });

  test("R resumes an asleep agent's own session", async () => {
    const nova = await hire(1);
    service.handleSignal({ crewId: nova.id, signal: { type: "idle" }, sessionId: "sess-1" });
    await expect(service.resume(nova.id)).rejects.toThrow("still running");
    service.handleExit(nova.id);
    const woken = await service.resume(nova.id);
    expect(woken.status).toBe("starting");
    expect(launcher.launches.at(-1)).toMatchObject({
      crewId: nova.id,
      prompt: "",
      resume: "sess-1",
    });
  });

  test("R restarts an exited shell, ready at once", async () => {
    const shell = await service.openShell({ deckId: "deck-1", consoleId: 6 });
    service.handleExit(shell.id);
    expect((await service.resume(shell.id)).status).toBe("idle");
    expect(launcher.launches.at(-1)).not.toHaveProperty("resume");
  });

  test("a failed resume leaves it asleep", async () => {
    const nova = await hire(1);
    service.handleExit(nova.id);
    launcher.failWith = new Error("Command not found: claude");
    await expect(service.resume(nova.id)).rejects.toThrow("Command not found");
    expect(service.member(nova.id).status).toBe("asleep");
  });
});

describe("kept lessons", () => {
  const kept = ["Run vp check first.", "Never touch the lockfile."];

  beforeEach(() => {
    service.lessonsWith((deckId) => (deckId === "deck-1" ? kept : []));
  });

  test("a hire carries the deck's kept lessons as instructions", async () => {
    await hire(1);
    expect(launcher.launches.at(-1)!.instructions).toBe(lessonsPrompt(kept));
  });

  test("a task hire has both the plan and the instructions", async () => {
    await hire(1, "Add dark mode");
    expect(launcher.launches.at(-1)).toMatchObject({
      plan: { instructions: BRIEF_INSTRUCTIONS },
      instructions: lessonsPrompt(kept),
    });
  });

  test("a resume carries them too", async () => {
    const nova = await hire(1);
    service.handleExit(nova.id);
    await service.resume(nova.id);
    expect(launcher.launches.at(-1)!.instructions).toBe(lessonsPrompt(kept));
  });

  test("another deck's crew get none", async () => {
    db.insert(decks).values({ id: "deck-2", name: "other", repoPath: scratch, modules: [] }).run();
    await service.hire({ deckId: "deck-2", consoleId: 0, task: "x", worktree: false });
    expect(launcher.launches.at(-1)).not.toHaveProperty("instructions");
  });

  test("a shell gets none", async () => {
    await service.openShell({ deckId: "deck-1", consoleId: 6 });
    expect(launcher.launches.at(-1)).not.toHaveProperty("instructions");
  });

  test("nothing kept means no instructions key", async () => {
    service.lessonsWith(() => []);
    await hire(1);
    expect(launcher.launches.at(-1)).not.toHaveProperty("instructions");
  });

  test("control characters in a kept lesson never reach the launch", async () => {
    service.lessonsWith(() => ["Run\x1b[2J \x9b31m the\ntests"]);
    await hire(1);
    const { instructions } = launcher.launches.at(-1)!;
    expect(typeof instructions).toBe("string");
    expect(instructions).toBe(lessonsPrompt(["Run [2J 31m the tests"]));
    // eslint-disable-next-line no-control-regex
    expect(instructions).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  });
});
