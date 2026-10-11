import { describe, expect, test } from "vite-plus/test";
import { logCards } from "../../src/features/log/cards.ts";
import type { MissionSummary } from "../../src/features/log/log.server.ts";
import {
  endedAgo,
  missionId,
  missionVerdict,
  type VerdictInput,
} from "../../src/features/log/model.ts";

const merged: VerdictInput = {
  outcome: "merged",
  briefRevisions: 1,
  nogos: 0,
  flags: 0,
  firstGo: true,
  firstClear: true,
  inspectorFailed: false,
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
      missionVerdict({ ...merged, briefRevisions: 0, firstGo: null, firstClear: null }),
    ).toEqual({ kind: "clean", line: "Clean" });
  });

  test("merged after trouble is rework, naming each part", () => {
    expect(
      missionVerdict({ ...merged, briefRevisions: 2, nogos: 2, flags: 1, firstGo: false }),
    ).toEqual({
      kind: "rework",
      line: "Shipped after rework: 2 NO-GO · flagged 1× · brief revised",
    });
    expect(missionVerdict({ ...merged, briefRevisions: 3 })).toEqual({
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
      missionVerdict({ ...merged, flags: 1, briefRevisions: 2, inspectorFailed: true }).line,
    ).toBe("Shipped after rework: flagged 1× · Inspector couldn't run · brief revised");
    expect(missionVerdict({ ...merged, outcome: "home", inspectorFailed: true })).toEqual({
      kind: "home",
      line: "Sent home: Inspector couldn't run",
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
