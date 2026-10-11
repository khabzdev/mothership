import { describe, expect, test } from "vite-plus/test";
import {
  chevronsFor,
  newPatches,
  PATCHES,
  pointsOf,
  rankOf,
  recordView,
  salutes,
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

describe("chevronsFor", () => {
  test.each([
    ["Cadet", 0],
    ["Ensign", 1],
    ["Lieutenant", 2],
    ["Commander", 3],
    ["Captain", "star"],
  ] as const)("%s wears %s", (title, chevrons) => {
    expect(chevronsFor(title)).toBe(chevrons);
  });
});

describe("recordView", () => {
  test("rank, points and how many to the next rank", () => {
    const view = recordView({ ...zero, merged: 2, cleanBriefs: 1, patches: [] });
    expect(view.rank).toBe("Ensign");
    expect(view.points).toBe(7);
    expect(view.toNext).toBe("8 to Lieutenant");
  });

  test("a Captain has no next rank", () => {
    expect(recordView({ ...zero, merged: 30, patches: [] }).toNext).toBeUndefined();
  });

  test("the six counters, in order", () => {
    const view = recordView({
      missions: 1,
      merged: 2,
      firstTryGo: 3,
      firstTryClear: 4,
      cleanBriefs: 5,
      lessonsKept: 6,
      patches: [],
    });
    expect(view.counters.map((c) => c.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(view.counters.map((c) => c.label)).toEqual([
      "Missions",
      "Merged",
      "First-try GOs",
      "First-try clear inspections",
      "Clean briefs",
      "Lessons kept",
    ]);
  });

  test("earned patches in the order earned, locked ones with their rule", () => {
    const view = recordView({ ...zero, patches: ["teacher", "first-launch", "bogus"] });
    expect(view.earned.map((p) => p.id)).toEqual(["teacher", "first-launch"]);
    expect(view.locked.map((p) => p.id)).toEqual([
      "clean-sheet",
      "steady-hand",
      "sharpshooter",
      "old-hand",
    ]);
    expect(view.locked[1]).toEqual({
      id: "steady-hand",
      name: "Steady Hand",
      rule: "5 first-try GOs",
    });
  });

  test("nothing earned: every patch locked", () => {
    const view = recordView({ ...zero, patches: [] });
    expect(view.earned).toEqual([]);
    expect(view.locked).toEqual(PATCHES);
  });
});

describe("salutes", () => {
  const msg = {
    type: "crew.promoted",
    deckId: "d1",
    crewId: "c1",
    name: "Nova",
    rank: "Ensign",
  } as const;

  test("the crew member promoted on this deck salutes", () => {
    expect(salutes(msg, "d1", "c1")).toBe(true);
  });

  test("anyone else, another deck or another message: no salute", () => {
    expect(salutes(msg, "d1", "c2")).toBe(false);
    expect(salutes(msg, "d2", "c1")).toBe(false);
    expect(salutes({ type: "deck.lessons", deckId: "d1" }, "d1", "c1")).toBe(false);
  });
});
