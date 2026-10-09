import { describe, expect, test } from "vite-plus/test";
import { findLines, plainLines } from "../../src/features/search/model.ts";

describe("terminal search", () => {
  test("terminal output becomes plain lines", () => {
    expect(plainLines("\x1b[1;31mError:\x1b[0m boom\r\nok\r\n\x1b]0;title\x07done")).toEqual([
      "Error: boom",
      "ok",
      "done",
    ]);
    expect(plainLines("50%\r100%")).toEqual(["100%"]);
  });

  test("lines with every word, newest first, capped", () => {
    const lines = ["npm test passed", "Npm test FAILED", "lint ok", "npm run test"];
    expect(findLines(lines, "npm test")).toEqual([
      { line: 3, text: "npm run test" },
      { line: 1, text: "Npm test FAILED" },
      { line: 0, text: "npm test passed" },
    ]);
    expect(findLines(lines, "npm", 1)).toHaveLength(1);
    expect(findLines(lines, "  ")).toEqual([]);
  });
});
