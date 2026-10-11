import { describe, expect, test } from "vite-plus/test";
import type { ScreenFrame } from "@spaceship/protocol";
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

describe("a narrow terminal (40 columns): wrapped lines", () => {
  // Recorded at 40 columns, as /lite's terminal shrinks the PTY.
  const WRAPPED_OPTION_1 = [
    " Would you like to proceed?",
    "",
    " ❯ 1. Yes, clear context and auto-accept",
    "    edits (shift+tab)",
    "   2. Yes, and auto-accept edits",
    "   3. Yes, manually approve edits",
    "   4. No, keep planning",
  ];
  const WRAPPED_OPTION_2 = [
    " Would you like to proceed?",
    "",
    " ❯ 1. Yes, clear context and auto-accept",
    "    edits (shift+tab)",
    "   2. Yes, and auto-accept edits (shift",
    "    +tab to approve next time)",
    "   3. Yes, manually approve edits",
    "   4. No, keep planning",
  ];
  const WRAPPED_HEADER = [
    " Claude has written up a plan and is",
    " ready to execute. Would you like to",
    " proceed?",
    "",
    " ❯ 1. Yes, clear context and auto-accept",
    "    edits (shift+tab)",
    "   2. Yes, and auto-accept edits",
    "   3. Yes, manually approve edits",
    "   4. No, keep",
    "    planning",
  ];

  test.each([
    ["a wrapped option 1", WRAPPED_OPTION_1],
    ["a wrapped option 2", WRAPPED_OPTION_2],
    ["a wrapped header", WRAPPED_HEADER],
  ])("%s: approve picks 2, revise picks 4", (_name, lines) => {
    expect(dialogShown(lines)).toBe(true);
    expect(findOption(lines, "approve")).toBe("2");
    expect(findOption(lines, "revise")).toBe("4");
  });

  test("a wrapped header split mid-phrase is still the dialog", () => {
    expect(dialogShown([" Would you like", " to proceed?"])).toBe(true);
    expect(dialogShown([" Would you like", "", " to proceed?"])).toBe(false);
  });

  test("never the clear-context option: with only that, nothing is picked", () => {
    const lines = [
      " Would you like to proceed?",
      " ❯ 1. Yes, clear context and auto-accept",
      "    edits (shift+tab)",
      "   3. No, keep planning",
    ];
    expect(findOption(lines, "approve")).toBeNull();
    expect(findOption(lines, "revise")).toBe("3");
  });

  test("a continuation cut off by an unindented line ends the block there", () => {
    const lines = [
      " Would you like to proceed?",
      " ❯ 1. Yes, clear context and auto-accept",
      "edits (shift+tab)",
      "   2. Yes, and auto-accept edits",
    ];
    expect(findOption(lines, "approve")).toBeNull();
  });

  test("an indented line straight under the header is no option", () => {
    const lines = [
      " Would you like to proceed?",
      "    and more",
      "   2. Yes, and auto-accept edits",
    ];
    expect(findOption(lines, "approve")).toBeNull();
  });
});
