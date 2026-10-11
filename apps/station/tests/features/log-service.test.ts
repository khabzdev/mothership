import type { ServerMsg } from "@mothership/protocol";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { CrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewService, type MissionEnd } from "../../src/features/crew/service.server.ts";
import { MissionLog } from "../../src/features/log/log.server.ts";
import { missionId } from "../../src/features/log/model.ts";
import { RankService } from "../../src/features/ranks/ranks.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import {
  briefs,
  crew as crewTable,
  decks,
  inspections,
  lessons,
  missions,
  preflightResults,
  preflights,
} from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  async launch() {}
  async write() {}
  async stop() {}
}

const T0 = 1_000_000;

let scratch: string;
let db: Db;
let sent: ServerMsg[];
let crew: CrewService;
let ranks: RankService;
let log: MissionLog;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-log-")));
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
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  db.insert(decks).values({ id: "deck-1", name: "shop", repoPath: repo, modules: [] }).run();
  sent = [];
  const broadcast = (msg: ServerMsg) => sent.push(msg);
  crew = new CrewService({ db, launcher: new FakeLauncher(), broadcast, home: join(scratch, "h") });
  ranks = new RankService({ db, broadcast, crew });
  log = new MissionLog({ db, broadcast });
  crew.onMissionEnd((end) => ranks.onMissionEnd(end));
  crew.onMissionEnd((end) => log.onMissionEnd(end));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(scratch, { recursive: true, force: true });
});

const hire = (consoleId = 0, worktree = true) =>
  crew.hire({
    deckId: "deck-1",
    consoleId,
    task: "Add dark mode\nwith a toggle",
    worktree,
  });

const since = (crewId: string) =>
  db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()!.missionSince;

let n = 0;
/** A stop pre-flight at `at`; a NO-GO one fails its `test` check. */
function preflight(crewId: string, state: "go" | "nogo", at: number, trigger = "stop") {
  const id = `p${n++}`;
  db.insert(preflights)
    .values({
      id,
      deckId: "deck-1",
      crewId,
      flight: 1,
      attempt: n,
      state,
      trigger: trigger as "stop",
      commit: "abc",
      fingerprint: "f",
      startedAt: at,
      finishedAt: at + 40,
    })
    .run();
  const result = (position: number, name: string, verdict: "go" | "nogo", tail: string) =>
    db
      .insert(preflightResults)
      .values({
        preflightId: id,
        checkId: `k${position}`,
        position,
        name,
        command: `vp ${name}`,
        verdict,
        exitCode: verdict === "go" ? 0 : 1,
        timedOut: false,
        durationMs: 10,
        tail,
      })
      .run();
  result(0, "check", "go", "all good");
  if (state === "nogo") result(1, "test", "nogo", "FAIL toggle.test.ts\n".repeat(200));
  return id;
}

function inspection(crewId: string, state: "cleared" | "flagged", at: number) {
  const id = `i${n++}`;
  db.insert(inspections)
    .values({
      id,
      deckId: "deck-1",
      crewId,
      flight: 1,
      attempt: n,
      trigger: "stop",
      state,
      fingerprint: "f",
      commit: "abc",
      findings: JSON.stringify(
        state === "flagged"
          ? [{ severity: "blocker", source: "review", title: "X", why: "Y" }]
          : [],
      ),
      startedAt: at,
    })
    .run();
  return id;
}

function brief(crewId: string, revision: number, state: "approved" | "revised", at: number) {
  db.insert(briefs)
    .values({
      id: `b${n++}`,
      deckId: "deck-1",
      crewId,
      revision,
      text: `## Goal\nPlan ${revision}`,
      state,
      ...(state === "revised" && { reason: "Too broad" }),
      createdAt: at,
    })
    .run();
}

const pr = (crewId: string, k = 1) =>
  crew.endMission(crewId, "pr", { url: `https://gh/pr/${k}`, branch: `mothership/b${k}` });
const logged = () => sent.filter((m) => m.type === "deck.log");

describe("MissionLog writing", () => {
  test("a pull request logs the mission once, even delivered twice", async () => {
    const nova = await hire();
    const start = since(nova.id);
    vi.setSystemTime(T0 + 100);
    sent = [];
    pr(nova.id);
    expect(db.select().from(missions).all()).toEqual([
      {
        id: missionId(nova.id, start),
        deckId: "deck-1",
        crewId: nova.id,
        name: nova.name,
        task: "Add dark mode",
        startedAt: start,
        endedAt: T0 + 100,
        how: "pr",
        prUrl: "https://gh/pr/1",
        branch: "mothership/b1",
      },
    ]);
    expect(logged()).toEqual([{ type: "deck.log", deckId: "deck-1" }]);

    const end: MissionEnd = {
      crewId: nova.id,
      deckId: "deck-1",
      name: nova.name,
      task: "Add dark mode",
      missionSince: start,
      endedAt: T0 + 200,
      how: "pr",
      prUrl: "https://gh/pr/1",
      branch: "mothership/b1",
      provider: "claude-code",
      ownWorktree: true,
    };
    log.onMissionEnd(end);
    expect(db.select().from(missions).all()).toHaveLength(1);
    expect(logged()).toHaveLength(1);
  });

  test("the task is stored as its first line, at most 200 characters", async () => {
    const nova = await crew.hire({
      deckId: "deck-1",
      consoleId: 0,
      task: `${"a".repeat(250)}\nmore`,
      worktree: true,
    });
    pr(nova.id);
    expect(db.select().from(missions).get()?.task).toBe("a".repeat(200));
  });

  test("sent home after a NO-GO is logged as sent home", async () => {
    const nova = await hire();
    preflight(nova.id, "nogo", T0 + 10);
    vi.setSystemTime(T0 + 100);
    await crew.sendHome(nova.id, "keep");
    const [summary] = log.list("deck-1");
    expect(summary).toMatchObject({
      id: missionId(nova.id, T0),
      name: nova.name,
      how: "home",
      endedAt: T0 + 100,
      verdict: { kind: "home", line: "Sent home: 1 NO-GO" },
    });
    expect(summary).not.toHaveProperty("prUrl");
  });

  test("X right after O logs one entry, not an empty sent-home one", async () => {
    const nova = await hire();
    preflight(nova.id, "go", T0 + 10);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    vi.setSystemTime(T0 + 150);
    await crew.sendHome(nova.id, "keep");
    expect(log.list("deck-1").map((m) => m.how)).toEqual(["pr"]);
    expect(logged()).toHaveLength(1);
  });

  test("sent home having done nothing logs nothing", async () => {
    const nova = await hire();
    vi.setSystemTime(T0 + 100);
    await crew.sendHome(nova.id, "keep");
    expect(log.list("deck-1")).toEqual([]);
  });

  test("shells and crew in the deck's checkout aren't logged", async () => {
    const shell = await crew.openShell({ deckId: "deck-1", consoleId: 0 });
    const inPlace = await hire(1, false);
    preflight(shell.id, "nogo", T0 + 10);
    preflight(inPlace.id, "nogo", T0 + 10);
    vi.setSystemTime(T0 + 100);
    await crew.sendHome(shell.id, "keep");
    await crew.sendHome(inPlace.id, "keep");
    expect(db.select().from(missions).all()).toEqual([]);
  });

  test("a re-hired call sign gets its own entry; the old one keeps its rows", async () => {
    const first = await hire();
    preflight(first.id, "nogo", T0 + 10);
    vi.setSystemTime(T0 + 100);
    await crew.sendHome(first.id, "remove");
    const again = await hire(3);
    expect(again.name).toBe(first.name);
    preflight(again.id, "go", T0 + 110);
    vi.setSystemTime(T0 + 200);
    pr(again.id);
    const [newer, older] = log.list("deck-1");
    expect(newer!.id).not.toBe(older!.id);
    expect(log.entry(older!.id)!.preflights.map((p) => p.state)).toEqual(["nogo"]);
    expect(log.entry(newer!.id)!.preflights.map((p) => p.state)).toEqual(["go"]);
  });
});

describe("MissionLog entries", () => {
  test("two missions on one crew member each show only their own rows", async () => {
    const nova = await hire();
    const early = preflight(nova.id, "go", T0 + 50);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    // Right at O's instant belongs to the next mission, as does anything after.
    const boundary = preflight(nova.id, "nogo", T0 + 100);
    const later = preflight(nova.id, "nogo", T0 + 150);
    vi.setSystemTime(T0 + 300);
    await crew.sendHome(nova.id, "keep");

    const [second, first] = log.list("deck-1");
    expect(first!.id).toBe(missionId(nova.id, T0));
    expect(second!.id).toBe(missionId(nova.id, T0 + 100));
    expect(log.entry(first!.id)!.preflights.map((p) => p.id)).toEqual([early]);
    expect(log.entry(second!.id)!.preflights.map((p) => p.id)).toEqual([boundary, later]);
    expect(second!.verdict).toEqual({ kind: "home", line: "Sent home: 2 NO-GO" });
  });

  test("an entry carries its briefs, runs, inspections and hand-backs", async () => {
    const nova = await hire();
    brief(nova.id, 1, "revised", T0 + 1);
    brief(nova.id, 2, "approved", T0 + 2);
    const nogo = preflight(nova.id, "nogo", T0 + 10);
    preflight(nova.id, "nogo", T0 + 15, "manual");
    preflight(nova.id, "go", T0 + 20);
    inspection(nova.id, "flagged", T0 + 30);
    inspection(nova.id, "cleared", T0 + 40);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);

    const entry = log.entry(missionId(nova.id, T0))!;
    expect(entry).toMatchObject({
      name: nova.name,
      task: "Add dark mode",
      startedAt: T0,
      endedAt: T0 + 100,
      how: "pr",
      prUrl: "https://gh/pr/1",
      branch: "mothership/b1",
      outcome: "open",
      verdict: { kind: "open", line: "Not merged" },
      handBacks: 2,
      lessons: [],
      briefs: [
        { revision: 1, state: "revised", text: "## Goal\nPlan 1", reason: "Too broad" },
        { revision: 2, state: "approved", text: "## Goal\nPlan 2" },
      ],
    });
    expect(entry.briefs[1]).not.toHaveProperty("reason");
    expect(entry.preflights[0]).toEqual({
      id: nogo,
      attempt: expect.any(Number),
      trigger: "stop",
      state: "nogo",
      commit: "abc",
      durationMs: 40,
      failed: ["test"],
    });
    expect(entry.preflights.map((p) => p.trigger)).toEqual(["stop", "manual", "stop"]);
    expect(entry.inspections.map((i) => i.state)).toEqual(["flagged", "cleared"]);
    expect(entry.inspections[0]!.findings).toEqual([
      { severity: "blocker", source: "review", title: "X", why: "Y" },
    ]);
    expect(log.entry("nope")).toBeNull();
  });

  test("the verdict follows the pull request: merged after rework, or closed", async () => {
    const nova = await hire();
    preflight(nova.id, "nogo", T0 + 10);
    preflight(nova.id, "go", T0 + 20);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    const id = missionId(nova.id, T0);
    expect(log.entry(id)!.outcome).toBe("open");
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    expect(log.entry(id)).toMatchObject({
      outcome: "merged",
      verdict: { kind: "rework", line: "Shipped after rework: 1 NO-GO" },
    });
    expect(log.list("deck-1")[0]!.rank).toEqual({ title: "Cadet", points: 3, next: 5 });

    const ada = await hire(1);
    vi.setSystemTime(T0 + 200);
    pr(ada.id, 2);
    ranks.onClosed("deck-1", "https://gh/pr/2");
    expect(log.entry(missionId(ada.id, T0 + 100))!.verdict).toEqual({
      kind: "open",
      line: "PR closed",
    });
  });

  test("a clean merged mission is Clean", async () => {
    const nova = await hire();
    brief(nova.id, 1, "approved", T0 + 1);
    preflight(nova.id, "go", T0 + 10);
    inspection(nova.id, "cleared", T0 + 20);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    expect(log.list("deck-1")[0]!.verdict).toEqual({ kind: "clean", line: "Clean" });
  });

  test("lessons tagged with the mission are in its entry", async () => {
    const nova = await hire();
    preflight(nova.id, "nogo", T0 + 10);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    const id = missionId(nova.id, T0);
    db.insert(lessons)
      .values([
        { id: "l1", deckId: "deck-1", text: "Run the tests", fromName: nova.name, missionId: id },
        { id: "l2", deckId: "deck-1", text: "Other", fromName: nova.name, missionId: "x:1" },
      ])
      .run();
    expect(log.entry(id)!.lessons).toEqual([{ id: "l1", text: "Run the tests", state: "pending" }]);
  });

  test("an entry holds no output; the run's failing checks' output loads apart", async () => {
    const nova = await hire();
    const run = preflight(nova.id, "nogo", T0 + 10);
    vi.setSystemTime(T0 + 100);
    pr(nova.id);
    const entry = log.entry(missionId(nova.id, T0))!;
    expect(JSON.stringify(entry)).not.toContain("FAIL toggle.test.ts");
    expect(JSON.stringify(entry).length).toBeLessThan(2000);
    expect(log.runOutput(run)).toEqual([
      { name: "test", tail: "FAIL toggle.test.ts\n".repeat(200) },
    ]);
    expect(log.runOutput("nope")).toEqual([]);
  });
});

describe("MissionLog list", () => {
  test("pages newest first, each mission once even sharing an end time", async () => {
    const crewIds: string[] = [];
    for (const c of [0, 1, 2]) {
      const member = await hire(c);
      crewIds.push(member.id);
      preflight(member.id, "go", T0 + 10);
    }
    vi.setSystemTime(T0 + 100);
    crewIds.forEach((id, k) => pr(id, k + 1));
    vi.setSystemTime(T0 + 200);
    const ada = await hire(3);
    preflight(ada.id, "go", T0 + 210);
    vi.setSystemTime(T0 + 300);
    pr(ada.id, 9);

    const all = log.list("deck-1");
    expect(all.map((m) => m.endedAt)).toEqual([T0 + 300, T0 + 100, T0 + 100, T0 + 100]);

    const page1 = log.list("deck-1", { before: { endedAt: T0 + 300, id: all[0]!.id }, limit: 2 });
    const last = page1.at(-1)!;
    const page2 = log.list("deck-1", { before: { endedAt: last.endedAt, id: last.id }, limit: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    const ids = [...page1, ...page2].map((m) => m.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.sort()).toEqual(crewIds.map((id) => missionId(id, T0)).sort());
    expect(log.list("deck-2")).toEqual([]);
  });

  test("lists 30 at a time by default", async () => {
    for (let k = 0; k < 31; k++) {
      db.insert(missions)
        .values({
          id: `m${k}`,
          deckId: "deck-1",
          crewId: `c${k}`,
          name: "Nova",
          task: "t",
          startedAt: k,
          endedAt: k + 1,
          how: "pr",
          prUrl: `https://gh/pr/${k}`,
        })
        .run();
    }
    const page = log.list("deck-1");
    expect(page).toHaveLength(30);
    expect(page[0]!.id).toBe("m30");
  });
});
