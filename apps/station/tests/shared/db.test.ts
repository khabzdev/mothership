import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { criteria, decks, missions, runs } from "../../src/shared/db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

let db: Db;

beforeEach(() => {
  db = createDb(":memory:", { migrationsFolder });
});

function insertDeck(repoPath = "/work/repo") {
  return db
    .insert(decks)
    .values({ id: crypto.randomUUID(), name: "repo", repoPath, modules: ["src", "tests"] })
    .returning()
    .get();
}

function insertMission(deckId: string) {
  return db
    .insert(missions)
    .values({ id: crypto.randomUUID(), deckId, goal: "Add dark mode" })
    .returning()
    .get();
}

describe("createDb", () => {
  test("applies migrations", () => {
    const tables = db.$client
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite_%' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(["criteria", "decks", "missions", "runs"]);
  });

  test("enables foreign keys", () => {
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});

describe("decks", () => {
  test("round-trips modules as JSON and stamps createdAt", () => {
    const deck = insertDeck();
    expect(deck.modules).toEqual(["src", "tests"]);
    expect(deck.createdAt).toBeInstanceOf(Date);
  });

  test("repo paths are unique", () => {
    insertDeck("/work/repo");
    expect(() => insertDeck("/work/repo")).toThrow(/UNIQUE/);
  });
});

describe("missions", () => {
  test("defaults to a fresh briefing mission with a full tank", () => {
    const mission = insertMission(insertDeck().id);
    expect(mission).toMatchObject({
      state: "briefing",
      attempts: 0,
      maxAttempts: 3,
      alert: null,
      resumeTo: null,
      prUrl: null,
    });
  });

  test("stores alerts as JSON", () => {
    const mission = insertMission(insertDeck().id);
    db.update(missions)
      .set({
        state: "redAlert",
        alert: { reason: "needsInput", detail: "Approve?" },
        resumeTo: "building",
      })
      .where(eq(missions.id, mission.id))
      .run();
    const saved = db.select().from(missions).where(eq(missions.id, mission.id)).get();
    expect(saved?.alert).toEqual({ reason: "needsInput", detail: "Approve?" });
  });

  test("rejects unknown states", () => {
    const deck = insertDeck();
    expect(() =>
      db.$client
        .prepare("insert into missions (id, deck_id, goal, state) values (?, ?, ?, ?)")
        .run("m1", deck.id, "g", "warping"),
    ).toThrow(/CHECK/);
  });

  test("must belong to an existing deck", () => {
    expect(() => insertMission("no-such-deck")).toThrow(/FOREIGN KEY/);
  });
});

describe("criteria and runs", () => {
  test("rejects unknown criterion kinds and verdicts", () => {
    const mission = insertMission(insertDeck().id);
    expect(() =>
      db.$client
        .prepare("insert into criteria (id, mission_id, position, kind) values (?, ?, ?, ?)")
        .run("c1", mission.id, 0, "vibes"),
    ).toThrow(/CHECK/);
    db.insert(criteria)
      .values({ id: "c2", missionId: mission.id, position: 0, kind: "command", command: "vp test" })
      .run();
    expect(() =>
      db.$client
        .prepare(
          "insert into runs (id, mission_id, criterion_id, attempt, verdict) values (?, ?, ?, ?, ?)",
        )
        .run("r1", mission.id, "c2", 1, "maybe"),
    ).toThrow(/CHECK/);
  });

  test("criterion positions are unique per mission", () => {
    const mission = insertMission(insertDeck().id);
    const values = {
      missionId: mission.id,
      position: 0,
      kind: "manual" as const,
      label: "Looks right",
    };
    db.insert(criteria)
      .values({ id: "c1", ...values })
      .run();
    expect(() =>
      db
        .insert(criteria)
        .values({ id: "c2", ...values })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  test("deleting a deck cascades to missions, criteria and runs", () => {
    const deck = insertDeck();
    const mission = insertMission(deck.id);
    db.insert(criteria)
      .values({ id: "c1", missionId: mission.id, position: 0, kind: "command", command: "vp test" })
      .run();
    db.insert(runs)
      .values({
        id: "r1",
        missionId: mission.id,
        criterionId: "c1",
        attempt: 1,
        verdict: "nogo",
        output: "1 failed",
        durationMs: 1200,
      })
      .run();

    db.delete(decks).where(eq(decks.id, deck.id)).run();

    expect(db.select().from(missions).all()).toEqual([]);
    expect(db.select().from(criteria).all()).toEqual([]);
    expect(db.select().from(runs).all()).toEqual([]);
  });
});
