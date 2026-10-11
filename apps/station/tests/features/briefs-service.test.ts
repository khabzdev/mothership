import type { ScreenFrame, ServerMsg } from "@mothership/protocol";
import type { CrewSignal } from "@mothership/providers";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { BriefService, CONFIRM_DELAY_MS } from "../../src/features/briefs/briefs.server.ts";
import { BRIEF_INSTRUCTIONS } from "../../src/features/briefs/model.ts";
import type { CrewLauncher, LaunchRequest } from "../../src/features/crew/launcher.server.ts";
import type { PromptFrom } from "../../src/features/crew/service.server.ts";
import { CrewService } from "../../src/features/crew/service.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { crew as crewTable, decks } from "../../src/shared/db/schema.ts";

const V1 = [
  "Ready to code?",
  "",
  " Would you like to proceed?",
  "",
  " ❯ 1. Yes, and auto-accept edits",
  "   2. Yes, and manually approve edits",
  "   3. No, keep planning",
];

const PLAN = "## Goal\nDark mode is on by default.\n\n## Approach\nFlip the flag.";

class FakeLauncher implements CrewLauncher {
  launches: LaunchRequest[] = [];
  /** What the crew's terminals were sent, through the launcher (prompts). */
  writes: [string, string][] = [];
  async launch(r: LaunchRequest) {
    this.launches.push(r);
  }
  async write(crewId: string, data: string) {
    this.writes.push([crewId, data]);
  }
  async stop() {}
}

let scratch: string;
let repo: string;
let db: Db;
let sent: ServerMsg[];
let launcher: FakeLauncher;
let crew: CrewService;
/** One write call per key or paste, in order: the brief service's and crew prompts' alike. */
let writes: string[];
let screen: string[];
/** Per-crew screens, over `screen`. */
let screens: Record<string, string[]>;
let screenFails: boolean;
/** When set, screen reads wait for it. */
let screenGate: Promise<void> | null;
/** Screen reads started. */
let reads: number;
/** Runs as the service types a key, before it lands; throws to fail the write. */
let onKey: ((data: string) => void) | null;
/** Whether Claude takes a typed key: its dialog leaves the screen. */
let keyCloses: boolean;
let service: BriefService;

const frame = (lines: string[]): ScreenFrame => ({
  cols: 80,
  rows: lines.length,
  lines: lines.map((text) => [[text, 0, 0, 0]]),
});

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-briefs-")));
  repo = join(scratch, "shop");
  execFileSync("git", ["init", "-q", repo]);
  writeFileSync(join(repo, "README.md"), "hi");
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  sent = [];
  writes = [];
  screen = V1;
  screens = {};
  screenFails = false;
  screenGate = null;
  reads = 0;
  onKey = null;
  keyCloses = true;
  const broadcast = (msg: ServerMsg) => sent.push(msg);
  launcher = new FakeLauncher();
  // Crew prompts go through the launcher: record them in the same list as the service's keys.
  launcher.write = async (crewId, data) => {
    launcher.writes.push([crewId, data]);
    writes.push(data);
  };
  crew = new CrewService({ db, launcher, broadcast, home: join(scratch, "home") });
  service = new BriefService({
    db,
    crew,
    screens: {
      screen: async (crewId) => {
        reads++;
        if (screenGate) await screenGate;
        if (screenFails) throw new Error("no session");
        return frame(screens[crewId] ?? screen);
      },
    },
    broadcast,
    write: async (crewId, data) => {
      onKey?.(data);
      writes.push(data);
      if (keyCloses) screens[crewId] = ["> "];
    },
  });
  crew.describeWith((id) => ({ brief: service.info(id) }));
  crew.briefWaitingWith((id) => service.waiting(id));
  crew.briefUnapprovedWith((id) => service.unapproved(id));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scratch, { recursive: true, force: true });
});

const hire = (consoleId = 0, task = "Add dark mode") =>
  crew.hire({ deckId: "deck-1", consoleId, task, worktree: false });

/** A hook signal, as the station hands it to both services. */
const signal = (crewId: string, s: CrewSignal) => {
  const e = { crewId, missionId: crewId, signal: s };
  crew.handleSignal(e);
  service.handleSignal(e);
};

const plan = (crewId: string, text = PLAN) => signal(crewId, { type: "plan", plan: text });

const cleanBriefs = (crewId: string) =>
  db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()!.cleanBriefs;

const briefMsgs = () => sent.filter((m) => m.type === "crew.brief");

describe("BriefService", () => {
  test("a plan signal makes a waiting brief", async () => {
    const { id } = await hire();
    plan(id);
    expect(service.info(id)).toEqual({
      revision: 1,
      state: "waiting",
      goal: "Dark mode is on by default.",
    });
    const member = crew.roster("deck-1")[0]!;
    expect(member).toMatchObject({ status: "needs_input", detail: "Brief ready" });
    expect(member.brief).toEqual(service.info(id));
    expect(briefMsgs()).toEqual([{ type: "crew.brief", deckId: "deck-1", crewId: id }]);
  });

  test("a second plan supersedes the first", async () => {
    const { id } = await hire();
    plan(id);
    plan(id, "## Goal\nBetter.");
    const history = service.history(id);
    expect(history.map((b) => b.state)).toEqual(["waiting", "superseded"]);
    expect(history.map((b) => b.revision)).toEqual([2, 1]);
    expect(history[1]!.settledAt).toBeGreaterThan(0);
  });

  test("approve types the auto-accept option once", async () => {
    const { id } = await hire();
    plan(id);
    expect(await service.approve(id)).toEqual({ ok: true });
    expect(writes).toEqual(["1"]);
    expect(service.history(id)[0]).toMatchObject({ state: "approved", approvedBy: "you" });
    expect(service.approved(id)).toMatchObject({ revision: 1, text: PLAN });
    expect(cleanBriefs(id)).toBe(1);

    expect(await service.approve(id)).toEqual({
      ok: false,
      message: "Already approved",
      openTerminal: false,
    });
    expect(writes).toEqual(["1"]);
  });

  test("a double approve types one key", async () => {
    const { id } = await hire();
    plan(id);
    const [a, b] = await Promise.all([service.approve(id), service.approve(id)]);
    expect([a, b]).toContainEqual({ ok: true });
    expect([a, b]).toContainEqual({ ok: false, message: "Already approved", openTerminal: false });
    expect(writes).toEqual(["1"]);
    expect(cleanBriefs(id)).toBe(1);
  });

  test("a brief settled while the screen is read gets no key", async () => {
    const { id } = await hire();
    plan(id);
    let release!: () => void;
    screenGate = new Promise((done) => (release = done));
    const answer = service.approve(id);
    // Past the first check, the read is pending: the edit lands now.
    await vi.waitFor(() => expect(reads).toBe(1));
    signal(id, { type: "working", activity: { tool: "Write", filePath: join(repo, "a.ts") } });
    expect(service.info(id)?.state).toBe("approved");
    release();
    expect(await answer).toEqual({ ok: false, message: "Already approved", openTerminal: false });
    expect(writes).toEqual([]);
  });

  test("revise types keep planning, then the reason as a station prompt", async () => {
    const { id } = await hire();
    plan(id);
    const heard: { crewId: string; from: PromptFrom }[] = [];
    crew.onPrompt((e) => heard.push(e));
    vi.useFakeTimers();
    const answer = service.revise(id, "Keep the light theme too");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS - 1);
    // Not settled until the dialog is seen gone.
    expect(writes).toEqual(["3"]);
    expect(service.info(id)?.state).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: true });
    expect(service.history(id)[0]).toMatchObject({
      state: "revised",
      reason: "Keep the light theme too",
    });
    expect(writes).toEqual(["3", "\x1b[200~Keep the light theme too\x1b[201~"]);
    expect(heard).toEqual([{ crewId: id, from: "station" }]);
    expect(cleanBriefs(id)).toBe(0);
  });

  test.each(["approve", "revise"] as const)(
    "%s: a key the dialog didn't take settles nothing and types nothing more",
    async (choice) => {
      const { id } = await hire();
      plan(id);
      keyCloses = false;
      vi.useFakeTimers();
      const answer = choice === "approve" ? service.approve(id) : service.revise(id, "smaller");
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS * 2);
      expect(await answer).toEqual({
        ok: false,
        message: "Couldn't find Nova's approval dialog: opened its terminal",
        openTerminal: true,
      });
      expect(writes).toEqual([choice === "approve" ? "1" : "3"]);
      expect(service.info(id)?.state).toBe("waiting");
      expect(cleanBriefs(id)).toBe(0);
    },
  );

  test.each(["approve", "revise"] as const)(
    "%s: a screen that can't be read after the key settles nothing",
    async (choice) => {
      const { id } = await hire();
      plan(id);
      onKey = () => {
        screenFails = true;
      };
      vi.useFakeTimers();
      const answer = choice === "approve" ? service.approve(id) : service.revise(id, "smaller");
      await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS * 2);
      expect(await answer).toEqual({
        ok: false,
        message: "Couldn't find Nova's approval dialog: opened its terminal",
        openTerminal: true,
      });
      expect(writes).toEqual([choice === "approve" ? "1" : "3"]);
      expect(service.info(id)?.state).toBe("waiting");
    },
  );

  test("a new plan during the wait: the reason isn't typed into it", async () => {
    const { id } = await hire();
    plan(id);
    vi.useFakeTimers();
    const answer = service.revise(id, "smaller");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS / 2);
    screens[id] = V1;
    plan(id, "## Goal\nSmaller.");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS);
    expect(await answer).toEqual({
      ok: false,
      message: "Already superseded",
      openTerminal: false,
    });
    expect(writes).toEqual(["3"]);
    expect(service.history(id).map((b) => [b.revision, b.state])).toEqual([
      [2, "waiting"],
      [1, "superseded"],
    ]);
  });

  test("no dialog on screen: nothing typed", async () => {
    const { id } = await hire();
    plan(id);
    screen = ["> "];
    expect(await service.approve(id)).toEqual({
      ok: false,
      message: "Couldn't find Nova's approval dialog: opened its terminal",
      openTerminal: true,
    });
    expect(writes).toEqual([]);
    expect(service.info(id)?.state).toBe("superseded");
  });

  test("a screen that can't be read is no dialog", async () => {
    const { id } = await hire();
    plan(id);
    screenFails = true;
    expect(await service.revise(id, "why")).toMatchObject({ ok: false, openTerminal: true });
    expect(writes).toEqual([]);
  });

  test("a dialog without the option: nothing typed, the brief still waits", async () => {
    const { id } = await hire();
    plan(id);
    screen = [" Would you like to proceed?", " 1. Yes", " 2. No"];
    expect(await service.approve(id)).toMatchObject({ ok: false, openTerminal: true });
    expect(writes).toEqual([]);
    expect(service.info(id)?.state).toBe("waiting");
  });

  test("an edit while waiting is approval in the terminal", async () => {
    const { id } = await hire();
    plan(id);
    signal(id, { type: "working", activity: { tool: "Read", filePath: join(repo, "a.ts") } });
    expect(service.info(id)?.state).toBe("waiting");
    signal(id, { type: "working", activity: { tool: "Write", filePath: join(repo, "src/a.ts") } });
    expect(service.history(id)[0]).toMatchObject({ state: "approved", approvedBy: "terminal" });
    expect(writes).toEqual([]);
  });

  test("only edits in its working directory approve in the terminal", async () => {
    const { id } = await hire();
    plan(id);
    // Claude writing its own plan file is still planning.
    const planFile = join(scratch, "home", ".claude", "plans", "x.md");
    signal(id, { type: "working", activity: { tool: "Write", filePath: planFile } });
    signal(id, { type: "working", activity: { tool: "Edit" } });
    // A sibling folder that only starts with the same name isn't inside it.
    signal(id, { type: "working", activity: { tool: "Edit", filePath: `${repo}-other/a.ts` } });
    expect(service.info(id)?.state).toBe("waiting");
  });

  test("a key that can't be typed: the brief still waits", async () => {
    const { id } = await hire();
    plan(id);
    onKey = () => {
      throw new Error("pty closed");
    };
    expect(await service.approve(id)).toEqual({
      ok: false,
      message: "Couldn't find Nova's approval dialog: opened its terminal",
      openTerminal: true,
    });
    expect(service.info(id)?.state).toBe("waiting");
    onKey = null;
    expect(await service.approve(id)).toEqual({ ok: true });
  });

  test("approved in the terminal while keep planning went in: no reason typed", async () => {
    const { id } = await hire();
    plan(id);
    onKey = () =>
      signal(id, { type: "working", activity: { tool: "Edit", filePath: join(repo, "a.ts") } });
    vi.useFakeTimers();
    const answer = service.revise(id, "smaller");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS * 2);
    expect(await answer).toEqual({ ok: false, message: "Already approved", openTerminal: false });
    expect(writes).toEqual(["3"]);
    expect(service.history(id)[0]).toMatchObject({ state: "approved", approvedBy: "terminal" });
  });

  test("a plan after a revision is the next revision", async () => {
    const { id } = await hire();
    plan(id);
    vi.useFakeTimers();
    const answer = service.revise(id, "smaller");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS);
    await answer;
    vi.useRealTimers();
    plan(id, "## Goal\nSmaller.");
    expect(service.history(id).map((b) => [b.revision, b.state])).toEqual([
      [2, "waiting"],
      [1, "revised"],
    ]);
  });

  test("reconcile supersedes a waiting brief whose dialog is gone", async () => {
    const a = await hire(0);
    const b = await hire(1);
    plan(a.id);
    plan(b.id);
    screens[b.id] = ["> "];
    await service.reconcile();
    expect(service.info(a.id)?.state).toBe("waiting");
    expect(service.info(b.id)?.state).toBe("superseded");
  });

  test("sending a crew member home supersedes its waiting brief", async () => {
    const { id } = await hire();
    plan(id);
    await crew.sendHome(id, "keep");
    expect(service.info(id)?.state).toBe("superseded");
  });

  test("planning: a brief that isn't approved yet", async () => {
    const { id } = await hire();
    expect(service.planning(id)).toBe(false);
    plan(id);
    expect(service.planning(id)).toBe(true);
    expect(service.waiting(id)).toBe(true);
    expect(await service.approve(id)).toEqual({ ok: true });
    expect(service.planning(id)).toBe(false);
    expect(service.waiting(id)).toBe(false);
  });

  test("planning: waiting or revised, not superseded", async () => {
    const { id } = await hire();
    plan(id);
    vi.useFakeTimers();
    const answer = service.revise(id, "smaller");
    await vi.advanceTimersByTimeAsync(CONFIRM_DELAY_MS);
    await answer;
    vi.useRealTimers();
    expect(service.info(id)?.state).toBe("revised");
    expect(service.planning(id)).toBe(true);
    // Y with no dialog on screen supersedes it: nothing is planning any more.
    plan(id, "## Goal\nAgain.");
    screens[id] = ["> "];
    await service.approve(id);
    expect(service.info(id)?.state).toBe("superseded");
    expect(service.planning(id)).toBe(false);
    // Resume still plans: no brief of its was ever approved.
    expect(service.unapproved(id)).toBe(true);
  });

  test("a revision-2 approval isn't clean", async () => {
    const { id } = await hire();
    plan(id);
    plan(id, "## Goal\nAgain.");
    expect(await service.approve(id)).toEqual({ ok: true });
    expect(service.approved(id)).toMatchObject({ revision: 2 });
    expect(cleanBriefs(id)).toBe(0);
  });

  test("hire with a task launches in plan mode", async () => {
    await hire(0);
    expect(launcher.launches[0]!.plan).toEqual({ instructions: BRIEF_INSTRUCTIONS });
    await hire(1, "   ");
    await crew.openShell({ deckId: "deck-1", consoleId: 2 });
    expect(launcher.launches[1]!.plan).toBeUndefined();
    expect(launcher.launches[2]!.plan).toBeUndefined();
  });

  test("resume plans again until a brief is approved", async () => {
    const { id } = await hire(3);
    plan(id);
    crew.handleExit(id);
    db.update(crewTable).set({ sessionId: "s-1" }).where(eq(crewTable.id, id)).run();
    await crew.resume(id);
    expect(launcher.launches.at(-1)).toMatchObject({
      resume: "s-1",
      plan: { instructions: BRIEF_INSTRUCTIONS },
    });
    plan(id, "## Goal\nAgain.");
    expect(await service.approve(id)).toEqual({ ok: true });
    crew.handleExit(id);
    await crew.resume(id);
    expect(launcher.launches.at(-1)).toMatchObject({ resume: "s-1" });
    expect(launcher.launches.at(-1)!.plan).toBeUndefined();
  });

  test("a crew member with no brief resumes without plan flags", async () => {
    const { id } = await hire();
    crew.handleExit(id);
    await crew.resume(id);
    expect(launcher.launches.at(-1)!.plan).toBeUndefined();
  });

  test("a crew process exiting supersedes its waiting brief", async () => {
    const { id } = await hire();
    plan(id);
    crew.handleExit(id);
    expect(service.info(id)?.state).toBe("superseded");
  });

  test("a session found gone on reconcile supersedes its waiting brief", async () => {
    const { id } = await hire();
    plan(id);
    crew.reconcile([]);
    expect(service.info(id)?.state).toBe("superseded");
  });

  test("your prompt is refused while a brief waits, and goes through once it's approved", async () => {
    const { id } = await hire();
    plan(id);
    await expect(crew.prompt(id, "Also add tests")).rejects.toThrow(
      "Nova has a brief waiting: Y to approve, N to revise",
    );
    expect(writes).toEqual([]);
    expect(await service.approve(id)).toEqual({ ok: true });
    await crew.prompt(id, "Also add tests");
    expect(writes.at(-1)).toBe("\x1b[200~Also add tests\x1b[201~");
  });

  test("approvedForTask ignores an approved brief from an earlier task", async () => {
    const { id } = await hire(0, "Task one");
    plan(id);
    await service.approve(id);
    expect(service.approvedForTask(id)).toMatchObject({ revision: 1, text: PLAN });
    // The crew member moves on to another task: its old brief doesn't cover it.
    db.update(crewTable).set({ task: "Task two" }).where(eq(crewTable.id, id)).run();
    expect(service.approvedForTask(id)).toBeNull();
    expect(service.approved(id)).toMatchObject({ revision: 1 });
  });
});
