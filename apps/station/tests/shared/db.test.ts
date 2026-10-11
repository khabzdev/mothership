import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import {
  crew,
  decks,
  inspections,
  lessons,
  missionPrs,
  preflightResults,
  preflights,
  serviceRecords,
} from "../../src/shared/db/schema.ts";

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
      "briefs",
      "console_labels",
      "crew",
      "deck_checks",
      "decks",
      "inspections",
      "lessons",
      "mission_prs",
      "preflight_results",
      "preflights",
      "queue_tasks",
      "service_records",
    ]);
  });

  test("a new deck has the Inspector on", () => {
    expect(deck().inspector).toBe(true);
  });

  test("inspections check their state and trigger", () => {
    const d = deck();
    const row = {
      id: "i1",
      deckId: d.id,
      crewId: "c1",
      flight: 1,
      attempt: 1,
      trigger: "stop" as const,
      state: "running" as const,
      fingerprint: "f",
      commit: "abc",
      findings: "[]",
    };
    db.insert(inspections).values(row).run();
    expect(db.select().from(inspections).get()).toMatchObject({ reason: null, briefId: null });
    expect(() =>
      db
        .insert(inspections)
        .values({ ...row, id: "i2", state: "bogus" as never })
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(inspections)
        .values({ ...row, id: "i3", trigger: "bogus" as never })
        .run(),
    ).toThrow(/CHECK/);
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

  test("lessons check their state and go with their deck", () => {
    const d = deck();
    const row = { id: "l1", deckId: d.id, text: "Run vp check", fromName: "Nova" };
    db.insert(lessons).values(row).run();
    expect(db.select().from(lessons).get()?.state).toBe("pending");
    expect(() =>
      db
        .insert(lessons)
        .values({ ...row, id: "l2", state: "bogus" as never })
        .run(),
    ).toThrow(/CHECK/);
    db.delete(decks).where(eq(decks.id, d.id)).run();
    expect(db.select().from(lessons).all()).toEqual([]);
  });

  test("service records are one per call sign per deck and go with their deck", () => {
    const d = deck();
    db.insert(serviceRecords).values({ deckId: d.id, name: "Nova" }).run();
    expect(db.select().from(serviceRecords).get()).toMatchObject({
      missions: 0,
      merged: 0,
      firstTryGo: 0,
      firstTryClear: 0,
      cleanBriefs: 0,
      lessonsKept: 0,
      patches: "[]",
    });
    expect(() => db.insert(serviceRecords).values({ deckId: d.id, name: "Nova" }).run()).toThrow(
      /UNIQUE|PRIMARY/,
    );
    db.delete(decks).where(eq(decks.id, d.id)).run();
    expect(db.select().from(serviceRecords).all()).toEqual([]);
  });

  test("mission PRs are one per url and go with their deck", () => {
    const d = deck();
    const row = { url: "https://github.com/o/r/pull/1", deckId: d.id, name: "Nova" };
    db.insert(missionPrs).values(row).run();
    expect(() => db.insert(missionPrs).values(row).run()).toThrow(/UNIQUE|PRIMARY/);
    db.delete(decks).where(eq(decks.id, d.id)).run();
    expect(db.select().from(missionPrs).all()).toEqual([]);
  });

  test("a new crew member starts a mission at 0", () => {
    expect(member(deck().id).missionSince).toBe(0);
  });

  test("migration 0011 folds clean briefs into service records and dates missions from hire", () => {
    // Everything up to 0010, a crew member holding two clean briefs, then 0011.
    const folder = mkdtempSync(join(tmpdir(), "migrations-"));
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const full = JSON.stringify(journal);
    journal.entries = journal.entries.filter(
      (e: { tag: string }) => e.tag !== "0011_debrief" && e.tag !== "0012_reconcile",
    );
    expect(journal.entries.at(-1).tag).toBe("0010_brief_task");
    writeFileSync(journalPath, JSON.stringify(journal));

    const client = new Database(":memory:");
    client.pragma("foreign_keys = ON");
    const old = drizzle(client);
    migrate(old, { migrationsFolder: folder });
    client.exec(
      `insert into decks (id, name, repo_path, modules) values ('d1', 'repo', '/r', '[]'), ('d2', 'other', '/o', '[]')`,
    );
    const insertCrew = client.prepare(
      `insert into crew (id, deck_id, console_id, name, color, character, cwd, clean_briefs, created_at)
       values (?, ?, ?, ?, '#fff', 'Knight', '/w', ?, ?)`,
    );
    insertCrew.run("c1", "d1", 0, "Nova", 2, 1234);
    insertCrew.run("c2", "d2", 0, "Nova", 1, 5678);
    insertCrew.run("c3", "d1", 1, "Rex", 0, 9);

    writeFileSync(journalPath, full);
    migrate(old, { migrationsFolder: folder });

    const records = client
      .prepare(
        "select deck_id, name, clean_briefs, missions, patches from service_records order by deck_id",
      )
      .all();
    expect(records).toEqual([
      { deck_id: "d1", name: "Nova", clean_briefs: 2, missions: 0, patches: "[]" },
      { deck_id: "d2", name: "Nova", clean_briefs: 1, missions: 0, patches: "[]" },
    ]);
    const since = client.prepare("select id, mission_since from crew order by id").all();
    expect(since).toEqual([
      { id: "c1", mission_since: 1234 },
      { id: "c2", mission_since: 5678 },
      { id: "c3", mission_since: 9 },
    ]);
  });

  test("migration 0012 adds merged_at and closed_at to mission_prs", () => {
    const client = new Database(":memory:");
    migrate(drizzle(client), { migrationsFolder });
    const cols = client.prepare("pragma table_info(mission_prs)").all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain("merged_at");
    expect(cols.map((c) => c.name)).toContain("closed_at");
  });

  test("migration 0012 marks pull requests already credited before it", () => {
    const folder = mkdtempSync(join(tmpdir(), "migrations-"));
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const full = JSON.stringify(journal);
    journal.entries = journal.entries.filter((e: { tag: string }) => e.tag !== "0012_reconcile");
    expect(journal.entries.at(-1).tag).toBe("0011_debrief");
    writeFileSync(journalPath, JSON.stringify(journal));

    const client = new Database(":memory:");
    client.pragma("foreign_keys = ON");
    const old = drizzle(client);
    migrate(old, { migrationsFolder: folder });
    client.exec(
      `insert into decks (id, name, repo_path, modules) values ('d1', 'repo', '/r', '[]');
       insert into mission_prs (url, deck_id, name, branch, opened_at)
       values ('https://gh/pr/1', 'd1', 'Nova', 'b1', 1234)`,
    );

    writeFileSync(journalPath, full);
    migrate(old, { migrationsFolder: folder });

    expect(client.prepare("select opened_at, merged_at, closed_at from mission_prs").all()).toEqual(
      [{ opened_at: 1234, merged_at: 1234, closed_at: null }],
    );
  });
});
