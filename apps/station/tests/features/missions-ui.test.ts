import type { Mission } from "@mothership/mission-engine";
import { describe, expect, test } from "vite-plus/test";
import {
  draftReducer,
  emptyDraft,
  toNewMission,
  type Draft,
} from "../../src/features/missions/ui/draft.ts";
import { fuelGauge, missionLamp } from "../../src/features/missions/ui/status.ts";

const step = (draft: Draft, ...actions: Parameters<typeof draftReducer>[1][]) =>
  actions.reduce(draftReducer, draft);

describe("brief draft", () => {
  test("starts with one empty command criterion and a 3-attempt tank", () => {
    expect(emptyDraft()).toMatchObject({
      goal: "",
      maxAttempts: 3,
      criteria: [{ kind: "command", text: "" }],
    });
  });

  test("criteria get stable keys and can be added, edited, retyped and removed", () => {
    let draft = step(
      emptyDraft(),
      { type: "setGoal", goal: "Add dark mode" },
      { type: "addCriterion" },
    );
    const [first, second] = draft.criteria;
    expect(first!.key).not.toBe(second!.key);

    draft = step(
      draft,
      { type: "editCriterion", key: first!.key, text: "vp test" },
      { type: "setKind", key: second!.key, kind: "manual" },
      { type: "editCriterion", key: second!.key, text: "Toggle looks right" },
    );
    expect(toNewMission(draft, "d1")).toEqual({
      deckId: "d1",
      goal: "Add dark mode",
      maxAttempts: 3,
      criteria: [
        { kind: "command", command: "vp test" },
        { kind: "manual", label: "Toggle looks right" },
      ],
    });

    draft = step(draft, { type: "removeCriterion", key: first!.key });
    expect(draft.criteria.map((c) => c.key)).toEqual([second!.key]);
  });

  test("the last criterion can't be removed", () => {
    const draft = emptyDraft();
    expect(
      step(draft, { type: "removeCriterion", key: draft.criteria[0]!.key }).criteria,
    ).toHaveLength(1);
  });

  test("the fuel tank is clamped to 1–10", () => {
    expect(step(emptyDraft(), { type: "setFuel", maxAttempts: 0 }).maxAttempts).toBe(1);
    expect(step(emptyDraft(), { type: "setFuel", maxAttempts: 99 }).maxAttempts).toBe(10);
  });

  test("blank criteria are dropped when submitting", () => {
    const draft = step(emptyDraft(), { type: "setGoal", goal: "g" }, { type: "addCriterion" });
    const [first] = draft.criteria;
    const filled = step(draft, { type: "editCriterion", key: first!.key, text: "vp test" });
    expect(toNewMission(filled, "d1").criteria).toEqual([{ kind: "command", command: "vp test" }]);
  });

  test("reset returns an empty draft", () => {
    const draft = step(emptyDraft(), { type: "setGoal", goal: "g" }, { type: "reset" });
    expect(draft.goal).toBe("");
  });
});

const mission = (overrides: Partial<Mission>): Mission => ({
  state: "briefing",
  brief: { goal: "g", criteria: [] },
  attempts: 0,
  maxAttempts: 3,
  ...overrides,
});

describe("missionLamp", () => {
  test.each<[Partial<Mission>, { label: string; tone: string }]>([
    [{ state: "briefing" }, { label: "Briefing", tone: "idle" }],
    [{ state: "building" }, { label: "Building", tone: "active" }],
    [{ state: "preflight" }, { label: "Pre-flight", tone: "check" }],
    [{ state: "launching" }, { label: "Launching", tone: "launch" }],
    [{ state: "launched" }, { label: "Launched", tone: "go" }],
    [
      { state: "redAlert", alert: { reason: "needsInput", detail: "?" } },
      { label: "Needs you", tone: "alert" },
    ],
    [
      { state: "redAlert", alert: { reason: "crashed", detail: "x" } },
      { label: "Crashed", tone: "alert" },
    ],
    [
      { state: "redAlert", alert: { reason: "outOfFuel", detail: "x" } },
      { label: "Out of fuel", tone: "alert" },
    ],
    [
      { state: "redAlert", alert: { reason: "launchFailed", detail: "x" } },
      { label: "Launch failed", tone: "alert" },
    ],
  ])("%j", (overrides, lamp) => {
    expect(missionLamp(mission(overrides))).toEqual(lamp);
  });
});

describe("fuelGauge", () => {
  test("one segment per attempt, burnt ones first", () => {
    expect(fuelGauge(mission({ attempts: 1, maxAttempts: 3 }))).toEqual(["burnt", "full", "full"]);
    expect(fuelGauge(mission({ attempts: 0, maxAttempts: 2 }))).toEqual(["full", "full"]);
    expect(fuelGauge(mission({ attempts: 4, maxAttempts: 3 }))).toEqual([
      "burnt",
      "burnt",
      "burnt",
    ]);
  });
});
