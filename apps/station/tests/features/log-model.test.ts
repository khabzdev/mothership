import { describe, expect, test } from "vite-plus/test";
import { logCards } from "../../src/features/log/cards.ts";
import type { MissionSummary } from "../../src/features/log/log.server.ts";
import {
  endedAgo,
  missionId,
  missionVerdict,
  stepSelection,
  type VerdictInput,
} from "../../src/features/log/model.ts";

const merged: VerdictInput = {
  outcome: "merged",
  briefRevised: false,
  briefApproved: true,
  nogos: 0,
  flags: 0,
  firstGo: true,
  firstClear: true,
  inspectorFailed: false,
  checksArmed: true,
  inspectorOn: true,
};

describe("missionId", () => {
  test("is the crew member and the mission's start", () => {
    expect(missionId("c1", 1234)).toBe("c1:1234");
  });
});

describe("missionVerdict", () => {
  test("merged on a first brief, first GO and first clear is clean", () => {
    expect(missionVerdict(merged)).toEqual({ kind: "clean", line: "Clean" });
  });

  test("no brief, no pre-flight and no inspection count as clean", () => {
    expect(
      missionVerdict({
        ...merged,
        briefApproved: null,
        firstGo: null,
        firstClear: null,
        checksArmed: false,
        inspectorOn: false,
      }),
    ).toEqual({ kind: "clean", line: "Clean" });
  });

  test("merged after trouble is rework, naming each part", () => {
    expect(
      missionVerdict({ ...merged, briefRevised: true, nogos: 2, flags: 1, firstGo: false }),
    ).toEqual({
      kind: "rework",
      line: "Shipped after rework: 2 NO-GO · flagged 1× · brief revised",
    });
    expect(missionVerdict({ ...merged, briefRevised: true })).toEqual({
      kind: "rework",
      line: "Shipped after rework: brief revised",
    });
    expect(missionVerdict({ ...merged, flags: 2, firstClear: false })).toEqual({
      kind: "rework",
      line: "Shipped after rework: flagged 2×",
    });
  });

  test("handed back after a first-try GO or clear still isn't clean", () => {
    expect(missionVerdict({ ...merged, nogos: 1 })).toEqual({
      kind: "rework",
      line: "Shipped after rework: 1 NO-GO",
    });
    expect(missionVerdict({ ...merged, flags: 1 })).toEqual({
      kind: "rework",
      line: "Shipped after rework: flagged 1×",
    });
  });

  test("an Inspector that couldn't run isn't clean, and says so", () => {
    expect(missionVerdict({ ...merged, firstClear: null, inspectorFailed: true })).toEqual({
      kind: "rework",
      line: "Shipped after rework: Inspector couldn't run",
    });
    expect(
      missionVerdict({ ...merged, flags: 1, briefRevised: true, inspectorFailed: true }).line,
    ).toBe("Shipped after rework: flagged 1× · Inspector couldn't run · brief revised");
    expect(missionVerdict({ ...merged, outcome: "home", inspectorFailed: true })).toEqual({
      kind: "home",
      line: "Sent home: Inspector couldn't run",
    });
  });

  test("a brief never approved keeps a merge from being clean", () => {
    expect(missionVerdict({ ...merged, briefApproved: false })).toEqual({
      kind: "rework",
      line: "Shipped after rework",
    });
  });

  test("gates that were on but never passed aren't clean, and say so", () => {
    expect(missionVerdict({ ...merged, firstGo: null })).toEqual({
      kind: "rework",
      line: "Shipped after rework: launched without a GO",
    });
    expect(missionVerdict({ ...merged, firstClear: null })).toEqual({
      kind: "rework",
      line: "Shipped after rework: not inspected",
    });
    // An Inspector that couldn't run says that, not "not inspected".
    expect(missionVerdict({ ...merged, firstClear: null, inspectorFailed: true }).line).toBe(
      "Shipped after rework: Inspector couldn't run",
    );
    expect(
      missionVerdict({
        ...merged,
        nogos: 1,
        flags: 2,
        firstGo: null,
        firstClear: null,
        briefRevised: true,
      }).line,
    ).toBe(
      "Shipped after rework: 1 NO-GO · flagged 2× · launched without a GO · not inspected · brief revised",
    );
    // Gates that were off ask for nothing.
    expect(
      missionVerdict({
        ...merged,
        firstGo: null,
        firstClear: null,
        checksArmed: false,
        inspectorOn: false,
      }),
    ).toEqual({ kind: "clean", line: "Clean" });
    const home = { ...merged, outcome: "home" as const, firstGo: null, firstClear: null };
    // A mission sent home never launched, so skipped gates aren't trouble on it.
    expect(missionVerdict(home)).toEqual({ kind: "home", line: "Sent home" });
    expect(missionVerdict({ ...home, nogos: 1 })).toEqual({
      kind: "home",
      line: "Sent home: 1 NO-GO",
    });
    expect(missionVerdict({ ...home, checksArmed: false, inspectorOn: false })).toEqual({
      kind: "home",
      line: "Sent home",
    });
  });

  test("an open pull request is not merged; a closed one says so", () => {
    expect(missionVerdict({ ...merged, outcome: "open" })).toEqual({
      kind: "open",
      line: "Not merged",
    });
    expect(missionVerdict({ ...merged, outcome: "closed", nogos: 1 })).toEqual({
      kind: "open",
      line: "PR closed",
    });
  });

  test("sent home, with its trouble when there was any", () => {
    const home = { ...merged, outcome: "home" as const };
    expect(missionVerdict(home)).toEqual({ kind: "home", line: "Sent home" });
    expect(missionVerdict({ ...home, nogos: 1, firstGo: false })).toEqual({
      kind: "home",
      line: "Sent home: 1 NO-GO",
    });
  });
});

describe("logCards", () => {
  const summary = (
    id: string,
    kind: MissionSummary["verdict"]["kind"],
    line: string,
  ): MissionSummary => ({
    id,
    name: `Crew ${id}`,
    task: "a task",
    endedAt: 1,
    how: kind === "home" ? "home" : "pr",
    verdict: { kind, line },
  });

  test("one card per mission: call sign, verdict line as is, coloured by kind", () => {
    const cards = logCards([
      summary("a", "clean", "Clean"),
      summary("b", "rework", "Shipped after rework: 2 NO-GO · flagged 1×"),
      summary("c", "open", "PR closed"),
      summary("d", "home", "Sent home: brief revised"),
    ]);
    expect(cards.map((c) => [c.key, c.label, c.title])).toEqual([
      ["a", "Crew a", "Clean"],
      ["b", "Crew b", "Shipped after rework: 2 NO-GO · flagged 1×"],
      ["c", "Crew c", "PR closed"],
      ["d", "Crew d", "Sent home: brief revised"],
    ]);
    // The boards' colours: green, amber, dim, red.
    expect(cards.map((c) => [c.color, c.dot])).toEqual([
      ["#c8f2d5", "#06d6a0"],
      ["#fff1b8", "#ffd166"],
      ["#dcdfe6", "#8d99ae"],
      ["#ffc2b3", "#ef476f"],
    ]);
  });

  test("the 4 newest only", () => {
    const many = ["a", "b", "c", "d", "e", "f"].map((id) => summary(id, "clean", "Clean"));
    expect(logCards(many).map((c) => c.key)).toEqual(["a", "b", "c", "d"]);
    expect(logCards([])).toEqual([]);
  });
});

describe("endedAgo", () => {
  test("how long ago a mission ended, roughly", () => {
    const min = 60_000;
    expect(endedAgo(30_000)).toBe("just now");
    expect(endedAgo(-5)).toBe("just now");
    expect(endedAgo(5 * min)).toBe("5m ago");
    expect(endedAgo(125 * min)).toBe("2h ago");
    expect(endedAgo(50 * 60 * min)).toBe("2d ago");
  });
});

describe("stepSelection", () => {
  test("keeps the same mission selected when a new one is logged above it", () => {
    expect(stepSelection(["b", "c"], "c", 0)).toBe("c");
    expect(stepSelection(["a", "b", "c"], "c", 0)).toBe("c");
    expect(stepSelection(["a", "b", "c"], "b", -1)).toBe("a");
    expect(stepSelection(["a", "b", "c"], "b", 1)).toBe("c");
  });

  test("clamps at the top and the bottom", () => {
    expect(stepSelection(["a", "b"], "a", -1)).toBe("a");
    expect(stepSelection(["a", "b"], "b", 1)).toBe("b");
  });

  test("a mission no longer listed, or none chosen yet, falls back to the first", () => {
    expect(stepSelection(["a", "b"], "gone", 0)).toBe("a");
    expect(stepSelection(["a", "b"], null, 0)).toBe("a");
    expect(stepSelection(["a", "b"], null, 1)).toBe("b");
    expect(stepSelection([], "a", 1)).toBeUndefined();
  });
});
