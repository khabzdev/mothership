import { describe, expect, test } from "vite-plus/test";
import {
  newPatches,
  PATCHES,
  pointsOf,
  rankOf,
  type ServiceCounters,
} from "../../src/features/ranks/model.ts";

const zero: ServiceCounters = {
  missions: 0,
  merged: 0,
  firstTryGo: 0,
  firstTryClear: 0,
  cleanBriefs: 0,
  lessonsKept: 0,
};

describe("pointsOf", () => {
  test("weights a merge three times", () => {
    expect(pointsOf({ ...zero, merged: 2, firstTryGo: 1, firstTryClear: 1, cleanBriefs: 1 })).toBe(
      9,
    );
  });

  test("missions and lessons earn nothing", () => {
    expect(pointsOf({ ...zero, missions: 9, lessonsKept: 9 })).toBe(0);
  });
});

describe("rankOf", () => {
  test.each([
    [0, "Cadet", 5],
    [4, "Cadet", 5],
    [5, "Ensign", 15],
    [14, "Ensign", 15],
    [15, "Lieutenant", 35],
    [34, "Lieutenant", 35],
    [35, "Commander", 70],
    [69, "Commander", 70],
  ])("%i points is %s, next at %i", (points, title, next) => {
    expect(rankOf(points)).toEqual({ title, points, next });
  });

  test("Captain has no next rank", () => {
    expect(rankOf(70)).toEqual({ title: "Captain", points: 70 });
    expect(rankOf(70).next).toBeUndefined();
    expect(rankOf(500).title).toBe("Captain");
  });
});

describe("newPatches", () => {
  test.each([
    ["first-launch", { merged: 1 }, { merged: 0 }],
    ["steady-hand", { firstTryGo: 5 }, { firstTryGo: 4 }],
    ["sharpshooter", { firstTryClear: 5 }, { firstTryClear: 4 }],
    ["old-hand", { merged: 10 }, { merged: 9 }],
    ["teacher", { lessonsKept: 1 }, { lessonsKept: 0 }],
  ] as const)("%s at its threshold and not one below", (id, at, below) => {
    expect(newPatches({ ...zero, ...at }, [])).toContain(id);
    expect(newPatches({ ...zero, ...below }, [])).not.toContain(id);
  });

  test("clean-sheet only comes with a clean mission", () => {
    expect(newPatches(zero, [])).toEqual([]);
    expect(newPatches(zero, [], { cleanSheet: false })).toEqual([]);
    expect(newPatches(zero, [], { cleanSheet: true })).toEqual(["clean-sheet"]);
  });

  test("leaves out patches already held, in PATCHES order", () => {
    const all = { ...zero, merged: 10, firstTryGo: 5, firstTryClear: 5, lessonsKept: 1 };
    expect(newPatches(all, ["first-launch"], { cleanSheet: true })).toEqual([
      "clean-sheet",
      "steady-hand",
      "sharpshooter",
      "old-hand",
      "teacher",
    ]);
    expect(
      newPatches(
        all,
        PATCHES.map((p) => p.id),
        { cleanSheet: true },
      ),
    ).toEqual([]);
  });
});

describe("PATCHES", () => {
  test("names the six patches", () => {
    expect(PATCHES.map((p) => p.name)).toEqual([
      "First Launch",
      "Clean Sheet",
      "Steady Hand",
      "Sharpshooter",
      "Old Hand",
      "Teacher",
    ]);
    expect(PATCHES.every((p) => p.rule.length > 0)).toBe(true);
  });
});
