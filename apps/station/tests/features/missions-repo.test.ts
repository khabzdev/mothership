import type { Brief, Mission } from "@mothership/mission-engine";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import {
  createMissionRecord,
  listMissions,
  loadMission,
  recordRuns,
  saveMission,
} from "../../src/features/missions/repo.server.ts";
import { createDb, type Db } from "../../src/shared/db/client.server.ts";
import { decks } from "../../src/shared/db/schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
let db: Db;
let deckId: string;

const brief: Omit<Brief, "criteria"> & {
  criteria: ({ kind: "command"; command: string } | { kind: "manual"; label: string })[];
} = {
  goal: "Add a dark mode toggle",
  criteria: [
    { kind: "command", command: "vp test" },
    { kind: "manual", label: "Toggle looks right" },
  ],
};

beforeEach(() => {
  db = createDb(":memory:", { migrationsFolder });
  deckId = db
    .insert(decks)
    .values({ id: "d1", name: "repo", repoPath: "/work/repo", modules: [] })
    .returning()
    .get().id;
});

describe("missions repo", () => {
  test("creates a briefing mission with ordered criteria", () => {
    const id = createMissionRecord(db, { deckId, ...brief, maxAttempts: 4 });
    const record = loadMission(db, id);
    expect(record).toMatchObject({ id, deckId, branch: null, worktreePath: null });
    expect(record.mission).toEqual({
      state: "briefing",
      brief: {
        goal: "Add a dark mode toggle",
        criteria: [
          { id: expect.any(String), kind: "command", command: "vp test" },
          { id: expect.any(String), kind: "manual", label: "Toggle looks right" },
        ],
      },
      attempts: 0,
      maxAttempts: 4,
    } satisfies Mission);
  });

  test("round-trips engine state including alerts", () => {
    const id = createMissionRecord(db, { deckId, ...brief });
    const { mission } = loadMission(db, id);
    const next: Mission = {
      ...mission,
      state: "redAlert",
      attempts: 2,
      alert: { reason: "needsInput", detail: "Approve?" },
      resumeTo: "building",
    };
    saveMission(db, id, next, { branch: "mothership/x", worktreePath: "/wt/x" });
    const record = loadMission(db, id);
    expect(record.mission).toEqual(next);
    expect(record).toMatchObject({ branch: "mothership/x", worktreePath: "/wt/x" });
  });

  test("clearing an alert removes it", () => {
    const id = createMissionRecord(db, { deckId, ...brief });
    const { mission } = loadMission(db, id);
    saveMission(db, id, {
      ...mission,
      state: "redAlert",
      alert: { reason: "crashed", detail: "x" },
      resumeTo: "building",
    });
    saveMission(db, id, { ...mission, state: "building" });
    const loaded = loadMission(db, id).mission;
    expect(loaded.alert).toBeUndefined();
    expect(loaded.resumeTo).toBeUndefined();
  });

  test("last pre-flight comes from the latest attempt's runs", () => {
    const id = createMissionRecord(db, { deckId, ...brief });
    const [tests, manual] = loadMission(db, id).mission.brief.criteria;
    recordRuns(db, id, 1, [
      { criterionId: tests!.id, verdict: "nogo", output: "1 failed", durationMs: 900 },
      { criterionId: manual!.id, verdict: "go" },
    ]);
    recordRuns(db, id, 2, [{ criterionId: tests!.id, verdict: "go", output: "ok" }]);
    expect(loadMission(db, id).mission.lastPreflight).toEqual([
      { criterionId: tests!.id, verdict: "go", output: "ok" },
    ]);
  });

  test("lists a deck's missions, newest first", () => {
    const first = createMissionRecord(db, { deckId, ...brief, goal: "first" });
    const second = createMissionRecord(db, { deckId, ...brief, goal: "second" });
    expect(listMissions(db, deckId).map((m) => m.id)).toEqual([second, first]);
  });

  test("loading an unknown mission throws", () => {
    expect(() => loadMission(db, "nope")).toThrow("No such mission: nope");
  });
});
