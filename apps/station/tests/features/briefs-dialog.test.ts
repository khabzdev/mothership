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

describe("only the last dialog's own options count", () => {
  const PLAN_THEN_V1 = [
    "Would you like to proceed? (my plan)",
    "2. Enable auto-accept in settings",
    "3. Skip the tests",
    "",
    ...V1,
  ];

  test("a plan's numbered list above the real dialog is ignored", () => {
    expect(findOption(PLAN_THEN_V1, "approve")).toBe("1");
    expect(findOption(PLAN_THEN_V1, "revise")).toBe("3");
  });

  test("a stale dialog above a live one: the live numbers win", () => {
    const stacked = [...V2, "", ...V1];
    expect(findOption(stacked, "approve")).toBe("1");
    expect(findOption(stacked, "revise")).toBe("3");
  });

  test("a non-option line after the header ends the option block", () => {
    const lines = [
      "Would you like to proceed?",
      "Pick one below:",
      "1. auto-accept edits",
      "3. keep planning",
    ];
    expect(findOption(lines, "approve")).toBeNull();
    expect(findOption(lines, "revise")).toBeNull();
  });

  test("header present, only keep-planning under it", () => {
    const lines = ["1. auto-accept foo", "Would you like to proceed?", "2. No, keep planning"];
    expect(findOption(lines, "approve")).toBeNull();
    expect(findOption(lines, "revise")).toBe("2");
  });
});
