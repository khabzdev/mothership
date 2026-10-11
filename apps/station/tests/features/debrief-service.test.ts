import type { ServerMsg } from "@mothership/protocol";
import { PROVIDERS } from "@mothership/providers";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { BriefService } from "../../src/features/briefs/briefs.server.ts";
import type { CrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewService, type MissionEnd } from "../../src/features/crew/service.server.ts";
import { DebriefService } from "../../src/features/debrief/debrief.server.ts";
import { MissionLog } from "../../src/features/log/log.server.ts";
import { missionId } from "../../src/features/log/model.ts";
import { PENDING_DAYS } from "../../src/features/debrief/model.ts";
import { InspectionService } from "../../src/features/inspection/inspection.server.ts";
import type { ReviewRun, RunReview } from "../../src/features/inspection/runner.server.ts";
import { ReviewSlot } from "../../src/features/inspection/slot.server.ts";
import { CheckService } from "../../src/features/preflight/checks.server.ts";
import { RankService } from "../../src/features/ranks/ranks.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import {
  briefs as briefsTable,
  crew as crewTable,
  decks,
  inspections,
  lessons,
  preflightResults,
  preflights,
} from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  async launch() {}
  async write() {}
  async stop() {}
}

type ReviewOpts = Parameters<RunReview>[0];

/** The `claude -p --output-format json` envelope around one fenced lessons block. */
const drafted = (lessonList: string[]): ReviewRun => ({
  ok: true,
  stdout: JSON.stringify({
    result: "```json\n" + JSON.stringify({ lessons: lessonList }) + "\n```",
  }),
  exitCode: 0,
  timedOut: false,
  durationMs: 5,
});

const LESSON = "Run `vp test` in apps/station before stopping.";

let scratch: string;
let repo: string;
let db: Db;
let sent: ServerMsg[];
let crew: CrewService;
let checks: CheckService;
let ranks: RankService;
let slot: ReviewSlot;
let calls: ReviewOpts[];
let answers: ReviewRun[];
let run: RunReview;
let debrief: DebriefService;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-debrief-")));
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
  sent = [];
  const broadcast = (msg: ServerMsg) => sent.push(msg);
  crew = new CrewService({
    db,
    launcher: new FakeLauncher(),
    broadcast,
    home: join(scratch, "home"),
  });
  checks = new CheckService({ db, broadcast, pendingCount: (id) => debrief.pendingCount(id) });
  ranks = new RankService({ db, broadcast, crew });
  slot = new ReviewSlot();
  calls = [];
  answers = [];
  run = async (opts) => {
    calls.push(opts);
    return answers.shift() ?? drafted([]);
  };
  debrief = new DebriefService({
    db,
    ranks,
    checks,
    providers: PROVIDERS,
    slot,
    broadcast,
    run: (o) => run(o),
  });
  crew.onMissionEnd((end) => ranks.onMissionEnd(end));
  crew.onMissionEnd((end) => debrief.onMissionEnd(end));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const hire = (consoleId = 0, worktree = true) =>
  crew.hire({ deckId: "deck-1", consoleId, task: "Add dark mode\nwith a toggle", worktree });

const row = (crewId: string) => db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()!;

let n = 0;
/** A NO-GO stop run on the crew member's current mission, `check` failing. */
function nogo(crewId: string, check = "test") {
  const member = row(crewId);
  const id = `p${n++}`;
  db.insert(preflights)
    .values({
      id,
      deckId: member.deckId,
      crewId,
      flight: 1,
      attempt: 1,
      state: "nogo",
      trigger: "stop",
      commit: "c",
      fingerprint: "f",
      startedAt: member.missionSince,
    })
    .run();
  db.insert(preflightResults)
    .values({
      preflightId: id,
      checkId: "k",
      position: 0,
      name: check,
      command: "vp test",
      verdict: "nogo",
      exitCode: 1,
      timedOut: false,
      durationMs: 3,
      tail: "FAIL toggle.test.ts",
    })
    .run();
}

const pr = (crewId: string, k = 1) =>
  crew.endMission(crewId, "pr", { url: `https://gh/pr/${k}`, branch: `mothership/b${k}` });

const debriefs = () =>
  sent.filter((m): m is Extract<ServerMsg, { type: "deck.debrief" }> => m.type === "deck.debrief");

const pause = () => new Promise((r) => setTimeout(r, 20));

/** Insert lessons straight into the table. */
function seed(count: number, state: "pending" | "kept" = "pending", createdAt = Date.now()) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `l${n++}`;
    ids.push(id);
    db.insert(lessons)
      .values({ id, deckId: "deck-1", text: `Lesson ${id}`, state, fromName: "Nova", createdAt })
      .run();
  }
  return ids;
}

describe("DebriefService drafting", () => {
  test("a mission with a NO-GO drafts lessons in the deck's checkout", async () => {
    const nova = await hire();
    nogo(nova.id, "typecheck");
    answers = [drafted([LESSON])];
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.plan.cwd).toBe(repo);
    expect(calls[0]!.prompt).toContain("typecheck");
    expect(calls[0]!.prompt).toContain("FAIL toggle.test.ts");
    expect(debriefs()[0]).toEqual({
      type: "deck.debrief",
      deckId: "deck-1",
      name: nova.name,
      drafted: 1,
    });
    expect(sent).toContainEqual({ type: "deck.lessons", deckId: "deck-1" });
    const { pending, kept } = debrief.list("deck-1");
    expect(kept).toEqual([]);
    expect(pending).toEqual([
      expect.objectContaining({
        text: LESSON,
        state: "pending",
        fromName: nova.name,
        evidence: "NO-GO: typecheck",
      }),
    ]);
    expect(debrief.pendingCount("deck-1")).toBe(1);
    expect(checks.message("deck-1")).toMatchObject({ lessonsPending: 1 });
  });

  test("drafted lessons are tagged with their mission and show in its log entry", async () => {
    const log = new MissionLog({ db, broadcast: (msg) => sent.push(msg) });
    crew.onMissionEnd((end) => log.onMissionEnd(end));
    const nova = await hire();
    const since = row(nova.id).missionSince;
    nogo(nova.id);
    answers = [drafted([LESSON])];
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    const id = missionId(nova.id, since);
    expect(db.select().from(lessons).get()?.missionId).toBe(id);
    expect(log.entry(id)?.lessons).toEqual([
      { id: expect.any(String), text: LESSON, state: "pending" },
    ]);
  });

  test("a flagged inspection and a revised brief count as trouble too", async () => {
    const nova = await hire();
    const since = row(nova.id).missionSince;
    db.insert(inspections)
      .values({
        id: "i1",
        deckId: "deck-1",
        crewId: nova.id,
        flight: 1,
        attempt: 1,
        trigger: "manual",
        state: "flagged",
        fingerprint: "f",
        commit: "c",
        findings: JSON.stringify([
          { severity: "blocker", title: "Breaks login", file: "a.ts", why: "No token" },
          { severity: "note", title: "Naming", why: "Meh" },
        ]),
        startedAt: since,
      })
      .run();
    db.insert(briefsTable)
      .values({
        id: "b1",
        deckId: "deck-1",
        crewId: nova.id,
        revision: 1,
        text: "## Goal\nShip the toggle\n## Approach\n…",
        state: "revised",
        reason: "Too broad",
        createdAt: since,
      })
      .run();
    pr(nova.id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.prompt).toContain("Breaks login (a.ts): No token");
    expect(calls[0]!.prompt).not.toContain("Naming");
    expect(calls[0]!.prompt).toContain("Ship the toggle: Too broad");
    expect(calls[0]!.prompt).toContain("Add dark mode");
    expect(calls[0]!.prompt).not.toContain("with a toggle");
  });

  test("a clean mission never runs the debrief", async () => {
    const nova = await hire();
    db.insert(preflights)
      .values({
        id: "ok",
        deckId: "deck-1",
        crewId: nova.id,
        flight: 1,
        attempt: 1,
        state: "go",
        trigger: "stop",
        commit: "c",
        fingerprint: "f",
        startedAt: row(nova.id).missionSince,
      })
      .run();
    pr(nova.id);
    await pause();
    expect(calls).toHaveLength(0);
    expect(debriefs()).toHaveLength(0);
  });

  test("trouble from an earlier mission isn't this one's", async () => {
    const nova = await hire();
    db.insert(preflights)
      .values({
        id: "old",
        deckId: "deck-1",
        crewId: nova.id,
        flight: 1,
        attempt: 1,
        state: "nogo",
        trigger: "stop",
        commit: "c",
        fingerprint: "f",
        startedAt: row(nova.id).missionSince - 1,
      })
      .run();
    pr(nova.id);
    await pause();
    expect(calls).toHaveLength(0);
  });

  test("crew in the deck's checkout, and shells, get no debrief", async () => {
    const nova = await hire(0, false);
    nogo(nova.id);
    pr(nova.id);
    const end: MissionEnd = {
      crewId: "s1",
      deckId: "deck-1",
      name: "Shell",
      task: "",
      missionSince: 0,
      endedAt: Date.now(),
      how: "home",
      provider: "shell",
      ownWorktree: true,
    };
    db.insert(preflights)
      .values({
        id: "shell-nogo",
        deckId: "deck-1",
        crewId: "s1",
        flight: 1,
        attempt: 1,
        state: "nogo",
        trigger: "stop",
        commit: "c",
        fingerprint: "f",
        startedAt: 1,
      })
      .run();
    debrief.onMissionEnd(end);
    await pause();
    expect(calls).toHaveLength(0);
  });

  test("O twice on one mission drafts one debrief", async () => {
    const nova = await hire();
    nogo(nova.id);
    answers = [drafted([LESSON])];
    pr(nova.id);
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    await pause();
    expect(calls).toHaveLength(1);
  });

  test("X right after O drafts one debrief, and still finishes with the crew gone", async () => {
    const nova = await hire();
    nogo(nova.id);
    answers = [drafted([LESSON])];
    pr(nova.id);
    await crew.sendHome(nova.id, "remove");
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    await pause();
    expect(calls).toHaveLength(1);
    expect(debrief.list("deck-1").pending).toHaveLength(1);
  });

  test("the same mission end delivered twice drafts once", async () => {
    const nova = await hire();
    nogo(nova.id);
    const member = row(nova.id);
    const end: MissionEnd = {
      crewId: nova.id,
      deckId: "deck-1",
      name: nova.name,
      task: member.task,
      missionSince: member.missionSince,
      endedAt: Date.now(),
      how: "home",
      provider: "claude-code",
      ownWorktree: true,
    };
    debrief.onMissionEnd(end);
    debrief.onMissionEnd({ ...end, endedAt: end.endedAt + 5 });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await pause();
    expect(calls).toHaveLength(1);
  });

  test("a run that fails says why and saves nothing", async () => {
    const nova = await hire();
    nogo(nova.id);
    answers = [{ ...drafted([LESSON]), ok: false, exitCode: 1, error: "Not logged in" }];
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(debriefs()[0]).toEqual({
      type: "deck.debrief",
      deckId: "deck-1",
      name: nova.name,
      drafted: 0,
      failed: "Not logged in",
    });
    expect(db.select().from(lessons).all()).toEqual([]);
  });

  test("an error envelope counts as can't-run", async () => {
    const nova = await hire();
    nogo(nova.id);
    answers = [
      { ...drafted([]), stdout: JSON.stringify({ is_error: true, result: "Credit balance" }) },
    ];
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(debriefs()[0]).toMatchObject({ drafted: 0, failed: expect.any(String) });
    expect(db.select().from(lessons).all()).toEqual([]);
  });

  test("a runner that throws is reported, not raised", async () => {
    const nova = await hire();
    nogo(nova.id);
    run = async () => {
      throw new Error("spawn EACCES");
    };
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(debriefs()[0]).toMatchObject({ drafted: 0, failed: "spawn EACCES" });
  });

  test("zero lessons drafted: nothing saved, nothing said", async () => {
    const nova = await hire();
    nogo(nova.id);
    pr(nova.id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await pause();
    expect(debriefs()).toEqual([]);
    expect(db.select().from(lessons).all()).toEqual([]);
  });

  test("kept lessons are in the prompt and not drafted again", async () => {
    const [id] = seed(1);
    debrief.keep(id!);
    const nova = await hire();
    nogo(nova.id);
    answers = [drafted([`lesson ${id}`, LESSON])];
    pr(nova.id);
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(calls[0]!.prompt).toContain(`Lesson ${id}`);
    expect(debriefs()[0]).toMatchObject({ drafted: 1 });
  });
});

describe("DebriefService sharing the review slot with the Inspector", () => {
  /** An Inspector on the same slot and runner, reviewing any worktree as one changed file. */
  function inspector() {
    const broadcast = (msg: ServerMsg) => sent.push(msg);
    return new InspectionService({
      db,
      crew,
      checks,
      briefs: new BriefService({
        db,
        crew,
        screens: { screen: async () => ({ cols: 80, rows: 0, lines: [] }) },
        broadcast,
        write: async () => {},
      }),
      preflight: { latest: () => null, stopAttempts: () => 0 },
      providers: PROVIDERS,
      broadcast,
      slot,
      run: (o) => run(o),
      readDiff: async () => ({ files: [{ path: "a.ts", additions: 1, deletions: 0 }], diff: "+a" }),
      fingerprint: async () => ({ hash: "h", commit: "c" }),
      homeRef: async () => "base",
    });
  }

  /** Runs wait here until released, or resolve as aborted. */
  function hold() {
    const held: (() => void)[] = [];
    run = (opts) =>
      new Promise((resolve) => {
        calls.push(opts);
        held.push(() => resolve(drafted([LESSON])));
        opts.signal?.addEventListener("abort", () =>
          resolve({ ...drafted([]), ok: false, error: "Aborted" }),
        );
      });
    return held;
  }

  test("a debrief waits for a running inspection, then runs", async () => {
    const inspection = inspector();
    const held = hold();
    const ada = await hire(0);
    const nova = await hire(1);
    inspection.afterGo(ada.id, { hash: "h", commit: "c" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    nogo(nova.id);
    pr(nova.id);
    await pause();
    expect(calls).toHaveLength(1);
    held.shift()!();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.prompt).toContain("debrief officer");
    held.shift()!();
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
    expect(inspection.latest(ada.id)?.state).not.toBe("running");
  });

  test("a cancelled inspection releases the slot to the debrief", async () => {
    const inspection = inspector();
    const held = hold();
    const ada = await hire(0);
    const nova = await hire(1);
    inspection.afterGo(ada.id, { hash: "h", commit: "c" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    nogo(nova.id);
    pr(nova.id);
    await pause();
    inspection.cancel(ada.id);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.prompt).toContain("debrief officer");
    held[1]!();
    await vi.waitFor(() => expect(debriefs()).toHaveLength(1));
  });

  test("an inspection waits behind a running debrief", async () => {
    const inspection = inspector();
    const held = hold();
    const ada = await hire(0);
    const nova = await hire(1);
    nogo(nova.id);
    pr(nova.id);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    inspection.afterGo(ada.id, { hash: "h", commit: "c" });
    await pause();
    expect(calls).toHaveLength(1);
    expect(inspection.info(ada.id)).toMatchObject({ queued: true });
    held.shift()!();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });
});

describe("DebriefService lessons", () => {
  test("keep, drop and retire move a lesson, each once", () => {
    const [a, b] = seed(2);
    expect(debrief.keep(a!)).toEqual({ ok: true });
    expect(debrief.keep(a!)).toEqual({ ok: false, message: "Already kept" });
    expect(debrief.drop(b!)).toEqual({ ok: true });
    expect(debrief.keep(b!)).toEqual({ ok: false, message: "Already dropped" });
    expect(debrief.kept("deck-1")).toEqual([`Lesson ${a}`]);
    expect(debrief.retire(a!)).toEqual({ ok: true });
    expect(debrief.retire(a!)).toEqual({ ok: false, message: "Already retired" });
    expect(debrief.kept("deck-1")).toEqual([]);
    expect(debrief.list("deck-1")).toEqual({ pending: [], kept: [] });
    const settled = db.select().from(lessons).where(eq(lessons.id, a!)).get()!;
    expect(settled.settledAt).toEqual(expect.any(Number));
  });

  test("an unknown lesson is refused", () => {
    expect(debrief.keep("nope")).toEqual({ ok: false, message: "No such lesson" });
  });

  test("each change refreshes the deck's lessons and its pending count", () => {
    const [a] = seed(2);
    sent = [];
    debrief.drop(a!);
    expect(sent).toContainEqual({ type: "deck.lessons", deckId: "deck-1" });
    expect(sent).toContainEqual(
      expect.objectContaining({ type: "deck.checks", deckId: "deck-1", lessonsPending: 1 }),
    );
  });

  test("a lesson from a mission refreshes the log when it moves; one without doesn't", () => {
    const [a, b, c] = seed(3);
    db.update(lessons).set({ missionId: "m1" }).where(eq(lessons.id, a!)).run();
    db.update(lessons).set({ missionId: "m1" }).where(eq(lessons.id, b!)).run();
    sent = [];
    debrief.keep(a!);
    expect(sent).toContainEqual({ type: "deck.log", deckId: "deck-1" });
    sent = [];
    debrief.retire(a!);
    expect(sent).toContainEqual({ type: "deck.log", deckId: "deck-1" });
    sent = [];
    debrief.drop(b!);
    expect(sent).toContainEqual({ type: "deck.log", deckId: "deck-1" });
    sent = [];
    debrief.drop(c!);
    expect(sent.some((m) => m.type === "deck.log")).toBe(false);
    sent = [];
    debrief.drop(b!); // already dropped: nothing changed
    expect(sent.some((m) => m.type === "deck.log")).toBe(false);
  });

  test("a 13th kept lesson waits for one to retire", () => {
    const ids = seed(13);
    for (const id of ids.slice(0, 12)) expect(debrief.keep(id)).toEqual({ ok: true });
    expect(debrief.keep(ids[12]!)).toEqual({
      ok: false,
      message: "Retire a lesson first (12 kept)",
    });
    expect(debrief.list("deck-1").pending.map((l) => l.id)).toEqual([ids[12]]);
    debrief.retire(ids[0]!);
    expect(debrief.keep(ids[12]!)).toEqual({ ok: true });
    expect(debrief.kept("deck-1")).toHaveLength(12);
  });

  test("keeping credits the call sign the lesson came from (Teacher)", () => {
    const [a] = seed(1);
    const spy = vi.spyOn(ranks, "lessonKept");
    debrief.keep(a!);
    expect(spy).toHaveBeenCalledWith("deck-1", "Nova");
    expect(ranks.record("deck-1", "Nova")).toMatchObject({
      lessonsKept: 1,
      patches: ["teacher"],
    });
  });

  test("list: pending newer than a week first-in first, then kept oldest first", () => {
    const day = 24 * 60 * 60 * 1000;
    const [old] = seed(1, "pending", Date.now() - (PENDING_DAYS + 1) * day);
    const [p1] = seed(1, "pending", Date.now() - 2 * day);
    const [p2] = seed(1, "pending", Date.now() - day);
    const [k2] = seed(1, "kept", Date.now() - day);
    const [k1] = seed(1, "kept", Date.now() - 3 * day);
    const { pending, kept } = debrief.list("deck-1");
    expect(pending.map((l) => l.id)).toEqual([p1, p2]);
    expect(kept.map((l) => l.id)).toEqual([k1, k2]);
    expect(debrief.pendingCount("deck-1")).toBe(2);
    expect(debrief.kept("deck-1")).toEqual([`Lesson ${k1}`, `Lesson ${k2}`]);
    expect(pending.map((l) => l.id)).not.toContain(old);
  });
});
