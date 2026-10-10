import type { ScreenFrame, ServerMsg } from "@mothership/protocol";
import type { CrewSignal } from "@mothership/providers";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { BriefService, REASON_DELAY_MS } from "../../src/features/briefs/briefs.server.ts";
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
        if (screenFails) throw new Error("no session");
        return frame(screens[crewId] ?? screen);
      },
    },
    broadcast,
    write: async (_crewId, data) => {
      writes.push(data);
    },
  });
  crew.describeWith((id) => ({ brief: service.info(id) }));
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
    expect(crew.member(id).cleanBriefs).toBe(1);

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
    const answer = service.approve(id);
    // The edit lands while the station is reading the screen.
    signal(id, { type: "working", activity: { tool: "Write" } });
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
    await vi.advanceTimersByTimeAsync(REASON_DELAY_MS - 1);
    expect(writes).toEqual(["3"]);
    expect(service.history(id)[0]).toMatchObject({
      state: "revised",
      reason: "Keep the light theme too",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: true });
    expect(writes).toEqual(["3", "\x1b[200~Keep the light theme too\x1b[201~"]);
    expect(heard).toEqual([{ crewId: id, from: "station" }]);
    expect(cleanBriefs(id)).toBe(0);
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
    signal(id, { type: "working", activity: { tool: "Read", filePath: "a.ts" } });
    expect(service.info(id)?.state).toBe("waiting");
    signal(id, { type: "working", activity: { tool: "Edit", filePath: "a.ts" } });
    expect(service.history(id)[0]).toMatchObject({ state: "approved", approvedBy: "terminal" });
    expect(writes).toEqual([]);
  });

  test("a plan after a revision is the next revision", async () => {
    const { id } = await hire();
    plan(id);
    vi.useFakeTimers();
    const answer = service.revise(id, "smaller");
    await vi.advanceTimersByTimeAsync(REASON_DELAY_MS);
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
    const { id } = await hire(3);
    crew.handleExit(id);
    db.update(crewTable).set({ sessionId: "s-1" }).where(eq(crewTable.id, id)).run();
    await crew.resume(id);
    expect(launcher.launches.at(-1)).toMatchObject({ resume: "s-1" });
    expect(launcher.launches.at(-1)!.plan).toBeUndefined();
  });
});
