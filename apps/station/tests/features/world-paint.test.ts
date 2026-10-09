import { describe, expect, test } from "vite-plus/test";
import { DECK_PAINTS, paintFor } from "../../src/features/world/paint.ts";

describe("deck paint", () => {
  test("a repo always gets the same paint", () => {
    expect(paintFor("/code/shop")).toBe(paintFor("/code/shop"));
  });

  test("different repos spread over the palette", () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => paintFor(`/code/repo-${i}`).name));
    expect(used.size).toBeGreaterThan(DECK_PAINTS.length / 2);
  });
});
