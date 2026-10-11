import { describe, expect, test } from "vite-plus/test";
import { missionId, missionVerdict, type VerdictInput } from "../../src/features/log/model.ts";

const merged: VerdictInput = {
  outcome: "merged",
  briefRevisions: 1,
  nogos: 0,
  flags: 0,
  firstGo: true,
  firstClear: true,
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
