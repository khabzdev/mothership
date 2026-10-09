import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { crew, decks } from "../../src/shared/db/schema.ts";

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
  test("applies all migrations, leaving decks, crew, console labels and the task queue", () => {
    const tables = db.$client
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite_%' order by name",
      )
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(["console_labels", "crew", "decks", "queue_tasks"]);
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
});
