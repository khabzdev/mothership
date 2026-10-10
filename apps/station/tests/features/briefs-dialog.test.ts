import { describe, expect, test } from "vite-plus/test";
import type { ScreenFrame } from "@mothership/protocol";
import { dialogShown, findOption, screenLines } from "../../src/features/briefs/dialog.ts";

const V1 = [
  "Ready to code?",
  "",
  " Would you like to proceed?",
  "",
  " ❯ 1. Yes, and auto-accept edits",
  "   2. Yes, and manually approve edits",
  "   3. No, keep planning",
];
const V2 = [
  " Would you like to proceed?",
  "  1. Yes, clear context and auto-accept edits (shift+tab)",
  "  2. Yes, and auto-accept edits",
  "  3. Yes, manually approve edits",
  "  4. No, keep planning",
];

describe("approval dialog reader", () => {
  test("finds the dialog", () => {
    expect(dialogShown(V1)).toBe(true);
    expect(dialogShown(["> "])).toBe(false);
  });

  test("approve picks plain auto-accept, by label not position", () => {
    expect(findOption(V1, "approve")).toBe("1");
    expect(findOption(V2, "approve")).toBe("2");
  });

  test("revise picks keep planning", () => {
    expect(findOption(V1, "revise")).toBe("3");
    expect(findOption(V2, "revise")).toBe("4");
  });

  test("no dialog, no option", () => {
    expect(findOption(["$ "], "approve")).toBeNull();
  });

  test("only option lines under the dialog count", () => {
    expect(findOption(["1. auto-accept edits is a setting", "> "], "approve")).toBeNull();
  });

  test("screenLines joins each line's run texts", () => {
    const frame: ScreenFrame = {
      cols: 80,
      rows: 2,
      lines: [
        [
          ["Would you ", 0, 0, 0],
          ["proceed?", 1, 0, 0],
        ],
        [
          ["1. Yes", 0, 0, 0],
          [", auto-accept", 0, 0, 0],
        ],
      ],
    };
    expect(screenLines(frame)).toEqual(["Would you proceed?", "1. Yes, auto-accept"]);
  });
});
