import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { crew, decks, preflightResults, preflights } from "../../src/shared/db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
let db: Db;

beforeEach(() => {
  db = createDb(":memory:", { migrationsFolder });
});

const deck = (repoPath = "/work/repo") =>
  db
    .insert(decks)
    .values({ id: crypto.randomUUID(), name: "repo", repoPath, modules: ["src"] })
    .returning()
    .get();

const member = (deckId: string, consoleId = 0) =>
  db
    .insert(crew)
    .values({
      id: crypto.randomUUID(),
      deckId,
      consoleId,
      name: "Nova",
      color: "#fff",
      character: "Knight",
      cwd: "/w",
    })
    .returning()
    .get();

describe("database", () => {
  test("applies all migrations, leaving decks, crew, labels, checks, pre-flights and the queue", () => {
    const tables = db.$client
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite_%' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual([
      "console_labels",
      "crew",
      "deck_checks",
      "decks",
      "preflight_results",
      "preflights",
      "queue_tasks",
    ]);
  });

  test("enables foreign keys", () => {
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  test("decks round-trip modules and have unique repo paths", () => {
    expect(deck().modules).toEqual(["src"]);
    expect(() => deck()).toThrow(/UNIQUE/);
  });

  test("crew start as starting with a timestamp", () => {
    const m = member(deck().id);
    expect(m).toMatchObject({
      status: "starting",
      task: "",
      action: null,
      provider: "claude-code",
      flight: 1,
      fuel: 3,
    });
    expect(m.statusSince).toBeGreaterThan(0);
  });

  test("one crew member per console per deck", () => {
    const d = deck();
    member(d.id, 3);
    expect(() => member(d.id, 3)).toThrow(/UNIQUE/);
    expect(member(deck("/other").id, 3).consoleId).toBe(3);
  });

  test("rejects unknown statuses and actions", () => {
    const m = member(deck().id);
    expect(() =>
      db.$client.prepare("update crew set status = 'lazy' where id = ?").run(m.id),
    ).toThrow(/CHECK/);
    expect(() =>
      db.$client.prepare("update crew set action = 'nap' where id = ?").run(m.id),
    ).toThrow(/CHECK/);
  });

  test("deleting a deck removes its crew", () => {
    const d = deck();
    member(d.id);
    db.delete(decks).where(eq(decks.id, d.id)).run();
    expect(db.select().from(crew).all()).toEqual([]);
  });

  test("pre-flights outlive their crew member and go with their deck", () => {
    const d = deck();
    const m = member(d.id);
    db.insert(preflights)
      .values({
        id: "p1",
        deckId: d.id,
        crewId: m.id,
        flight: 1,
        attempt: 1,
        trigger: "stop",
        commit: "abc",
        fingerprint: "def",
      })
      .run();
    db.insert(preflightResults)
      .values({
        preflightId: "p1",
        checkId: "k1",
        position: 0,
        name: "test",
        command: "vp test",
        verdict: "go",
        exitCode: 0,
        timedOut: false,
        durationMs: 1,
        tail: "",
      })
      .run();
    expect(db.select().from(preflights).get()?.state).toBe("running");
    expect(() =>
      db.$client.prepare("update preflight_results set verdict = 'maybe'").run(),
    ).toThrow(/CHECK/);
    db.delete(crew).where(eq(crew.id, m.id)).run();
    expect(db.select().from(preflights).all()).toHaveLength(1);
    db.delete(decks).where(eq(decks.id, d.id)).run();
    expect(db.select().from(preflights).all()).toEqual([]);
    expect(db.select().from(preflightResults).all()).toEqual([]);
  });
});
