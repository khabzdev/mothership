import { describe, expect, test } from "vite-plus/test";
import { matchScore, rank } from "../../src/features/palette/match.ts";

describe("palette matching", () => {
  test("words, word starts and scattered letters all match, best first", () => {
    const titles = ["Fix Login Redirect", "Nova", "Launch board", "Flaky login test"];
    // Both match at a word start: the shorter title first.
    expect(rank("login", titles, (t) => [t])).toEqual(["Flaky login test", "Fix Login Redirect"]);
    expect(rank("lb", titles, (t) => [t])).toEqual(["Launch board"]);
    expect(rank("fix redir", titles, (t) => [t])).toEqual(["Fix Login Redirect"]);
    expect(rank("zzz", titles, (t) => [t])).toEqual([]);
  });

  test("a title match beats a match in the extra text", () => {
    expect(matchScore("nova", "Nova", "Console 3")).toBeGreaterThan(
      matchScore("nova", "Console 3", "Nova"),
    );
  });

  test("an empty query keeps everything in order", () => {
    expect(rank(" ", ["b", "a"], (t) => [t])).toEqual(["b", "a"]);
  });
});
