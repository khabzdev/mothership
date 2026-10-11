import type { ServerMsg } from "@mothership/protocol";
import { eq } from "drizzle-orm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import type { CrewLauncher } from "../../src/features/crew/launcher.server.ts";
import { CrewService } from "../../src/features/crew/service.server.ts";
import { RankService } from "../../src/features/ranks/ranks.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import {
  briefs,
  crew as crewTable,
  decks,
  inspections,
  missionPrs,
  preflights,
} from "../../src/shared/db/schema.ts";

class FakeLauncher implements CrewLauncher {
  async launch() {}
  async write() {}
  async stop() {}
}

let scratch: string;
let db: Db;
let sent: ServerMsg[];
let crew: CrewService;
let ranks: RankService;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "mothership-ranks-")));
  db = createDb(":memory:", {
    migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)),
  });
  for (const name of ["shop", "docs"]) {
    const repo = join(scratch, name);
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, "README.md"), "hi");
    db.insert(decks)
      .values({ id: name === "shop" ? "deck-1" : "deck-2", name, repoPath: repo, modules: [] })
      .run();
  }
  sent = [];
  const broadcast = (msg: ServerMsg) => sent.push(msg);
  crew = new CrewService({ db, launcher: new FakeLauncher(), broadcast, home: join(scratch, "h") });
  ranks = new RankService({ db, broadcast, crew });
  crew.describeWith((id) => ({ ...ranks.info(id) }));
  crew.onMissionEnd((end) => ranks.onMissionEnd(end));
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const hire = (consoleId = 0, deckId = "deck-1") =>
  crew.hire({ deckId, consoleId, task: "Add dark mode", worktree: false });

/** Rows for the crew member's current mission, `at` ms after it started. */
function since(crewId: string) {
  const row = db.select().from(crewTable).where(eq(crewTable.id, crewId)).get()!;
  const common = { deckId: row.deckId, crewId, commit: "c", fingerprint: "f" };
  let n = 0;
  return {
    preflight(state: "go" | "nogo" | "cancelled" | "running", at: number, trigger = "stop") {
      db.insert(preflights)
        .values({
          ...common,
          id: `p${n++}`,
          flight: 1,
          attempt: n,
          state,
          trigger: trigger as "stop",
          startedAt: row.missionSince + at,
        })
        .run();
    },
    inspection(state: "cleared" | "flagged" | "cancelled", at: number, trigger = "stop") {
      db.insert(inspections)
        .values({
          ...common,
          id: `i${n++}`,
          flight: 1,
          attempt: n,
          state,
          trigger: trigger as "stop",
          startedAt: row.missionSince + at,
        })
        .run();
    },
    brief(revision: number, state: "approved" | "revised" | "superseded", at: number) {
      db.insert(briefs)
        .values({
          id: `b${n++}`,
          deckId: row.deckId,
          crewId,
          revision,
          text: "## Goal\nX",
          state,
          createdAt: row.missionSince + at,
        })
        .run();
    },
  };
}

const promoted = () => sent.filter((m) => m.type === "crew.promoted");
const pr = (crewId: string, n = 1) =>
  crew.endMission(crewId, "pr", { url: `https://gh/pr/${n}`, branch: `mothership/b${n}` });

describe("RankService", () => {
  test("a fresh call sign has a zero record and no patches", async () => {
    const nova = await hire();
    expect(ranks.record("deck-1", "Nova")).toEqual({
      missions: 0,
      merged: 0,
      firstTryGo: 0,
      firstTryClear: 0,
      cleanBriefs: 0,
      lessonsKept: 0,
      patches: [],
    });
    expect(ranks.info(nova.id)).toEqual({ rank: { title: "Cadet", points: 0, next: 5 } });
    expect(crew.member(nova.id)).not.toHaveProperty("patches");
  });

  test("a clean mission: first-try GO and clear on a rev-1 brief earns Clean Sheet", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.brief(1, "approved", 1);
    rows.preflight("go", 2);
    rows.inspection("cleared", 3);
    sent = [];
    pr(nova.id);
    expect(ranks.record("deck-1", "Nova")).toMatchObject({
      missions: 1,
      firstTryGo: 1,
      firstTryClear: 1,
      patches: ["clean-sheet"],
    });
    expect(promoted()).toEqual([
      {
        type: "crew.promoted",
        deckId: "deck-1",
        crewId: nova.id,
        name: "Nova",
        patch: "clean-sheet",
      },
    ]);
    // The roster shows it straight away.
    const roster = sent.filter((m) => m.type === "crew.roster").at(-1)!;
    expect(roster.crew[0]).toMatchObject({
      rank: { title: "Cadet", points: 2, next: 5 },
      patches: ["clean-sheet"],
    });
    expect(db.select().from(missionPrs).all()).toEqual([
      expect.objectContaining({
        url: "https://gh/pr/1",
        deckId: "deck-1",
        name: "Nova",
        branch: "mothership/b1",
      }),
    ]);
  });

  test("a NO-GO first isn't a first-try GO, and costs the clean sheet", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.brief(1, "approved", 1);
    rows.preflight("nogo", 2);
    rows.preflight("go", 3);
    rows.inspection("cleared", 4);
    pr(nova.id);
    expect(ranks.record("deck-1", "Nova")).toMatchObject({
      missions: 1,
      firstTryGo: 0,
      firstTryClear: 1,
      patches: [],
    });
    expect(promoted()).toEqual([]);
  });

  test("cancelled and manual runs don't count as the first try", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.preflight("cancelled", 1);
    rows.preflight("nogo", 2, "manual");
    rows.preflight("go", 3);
    rows.inspection("cancelled", 4);
    rows.inspection("flagged", 5, "manual");
    rows.inspection("cleared", 6);
    pr(nova.id);
    expect(ranks.record("deck-1", "Nova")).toMatchObject({ firstTryGo: 1, firstTryClear: 1 });
  });

  test("rows from an earlier mission don't count", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.preflight("go", -5);
    rows.inspection("cleared", -4);
    rows.brief(1, "approved", -3);
    pr(nova.id);
    expect(ranks.record("deck-1", "Nova")).toMatchObject({
      missions: 1,
      firstTryGo: 0,
      firstTryClear: 0,
      patches: [],
    });
  });

  test("a rev-2 brief isn't a clean sheet", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.brief(1, "revised", 1);
    rows.brief(2, "approved", 2);
    rows.preflight("go", 3);
    rows.inspection("cleared", 4);
    pr(nova.id);
    expect(ranks.record("deck-1", "Nova").patches).toEqual([]);
  });

  test("a mission that ends twice counts once", async () => {
    const nova = await hire();
    const rows = since(nova.id);
    rows.preflight("go", 1);
    pr(nova.id);
    // The same pull request again, then X right after O.
    pr(nova.id);
    await crew.sendHome(nova.id, "keep");
    expect(ranks.record("deck-1", "Nova")).toMatchObject({ missions: 1, firstTryGo: 1 });
    expect(db.select().from(missionPrs).all()).toHaveLength(1);
  });

  test("sent home without a pull request earns nothing", async () => {
    const nova = await hire();
    since(nova.id).preflight("go", 1);
    await crew.sendHome(nova.id, "keep");
    expect(ranks.record("deck-1", "Nova")).toMatchObject({ missions: 0, firstTryGo: 0 });
    expect(db.select().from(missionPrs).all()).toEqual([]);
  });

  test("a merge after the crew member went home still credits its call sign", async () => {
    const nova = await hire();
    pr(nova.id);
    await crew.sendHome(nova.id, "keep");
    sent = [];
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "elsewhere" });
    expect(ranks.record("deck-1", "Nova")).toMatchObject({
      merged: 1,
      patches: ["first-launch"],
    });
    expect(promoted()).toEqual([
      expect.objectContaining({ deckId: "deck-1", name: "Nova", patch: "first-launch" }),
    ]);
    expect(promoted()[0]).not.toHaveProperty("rank");
  });

  test("a merge is matched by branch when the url isn't known", async () => {
    const nova = await hire();
    pr(nova.id, 7);
    ranks.onMerged("deck-2", { url: "https://gh/pr/x", branch: "mothership/b7" });
    expect(ranks.record("deck-1", "Nova").merged).toBe(0);
    ranks.onMerged("deck-1", { url: "https://gh/pr/x", branch: "mothership/b7" });
    expect(ranks.record("deck-1", "Nova").merged).toBe(1);
  });

  test("an unknown pull request changes nothing", async () => {
    await hire();
    sent = [];
    ranks.onMerged("deck-1", { url: "https://gh/pr/404", branch: "nope" });
    expect(ranks.record("deck-1", "Nova").merged).toBe(0);
    expect(sent).toEqual([]);
  });

  test("crossing 5 points promotes to Ensign, once", async () => {
    const nova = await hire();
    pr(nova.id, 1);
    pr(nova.id, 2);
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    expect(promoted().filter((m) => m.rank)).toEqual([]);
    ranks.onMerged("deck-1", { url: "https://gh/pr/2", branch: "" });
    ranks.cleanBrief(nova.id);
    expect(promoted().filter((m) => m.rank)).toEqual([
      { type: "crew.promoted", deckId: "deck-1", crewId: nova.id, name: "Nova", rank: "Ensign" },
    ]);
    expect(ranks.info(nova.id)?.rank).toEqual({ title: "Ensign", points: 7, next: 15 });
  });

  test("a kept lesson earns Teacher", async () => {
    const nova = await hire();
    ranks.lessonKept("deck-1", "Nova");
    expect(ranks.record("deck-1", "Nova")).toMatchObject({ lessonsKept: 1, patches: ["teacher"] });
    expect(promoted()).toEqual([
      { type: "crew.promoted", deckId: "deck-1", crewId: nova.id, name: "Nova", patch: "teacher" },
    ]);
  });

  test("patches are kept in the order earned", async () => {
    const nova = await hire();
    ranks.lessonKept("deck-1", "Nova");
    pr(nova.id);
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    expect(ranks.record("deck-1", "Nova").patches).toEqual(["teacher", "first-launch"]);
  });

  test("a re-hire on the same deck inherits the record; another deck starts fresh", async () => {
    const nova = await hire();
    pr(nova.id);
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    const before = ranks.info(nova.id);
    await crew.sendHome(nova.id, "keep");

    const again = await hire(3);
    expect(again.name).toBe("Nova");
    expect(ranks.info(again.id)).toEqual(before);
    expect(crew.member(again.id)).toMatchObject({ rank: before!.rank, patches: ["first-launch"] });

    const elsewhere = await hire(0, "deck-2");
    expect(elsewhere.name).toBe("Nova");
    expect(ranks.info(elsewhere.id)).toEqual({ rank: { title: "Cadet", points: 0, next: 5 } });
    expect(crew.member(elsewhere.id)).not.toHaveProperty("patches");
  });

  test("a shell never shows a rank, even under a call sign with a record", async () => {
    const nova = await hire();
    pr(nova.id);
    ranks.onMerged("deck-1", { url: "https://gh/pr/1", branch: "" });
    await crew.sendHome(nova.id, "keep");

    const shell = await crew.openShell({ deckId: "deck-1", consoleId: 3 });
    expect(shell.name).toBe("Nova");
    expect(ranks.info(shell.id)).toBeUndefined();
    expect(crew.member(shell.id)).not.toHaveProperty("rank");
    expect(crew.member(shell.id)).not.toHaveProperty("patches");
  });

  test("an unknown crew member has no rank", () => {
    expect(ranks.info("nobody")).toBeUndefined();
    ranks.cleanBrief("nobody");
    expect(sent).toEqual([]);
  });
});
