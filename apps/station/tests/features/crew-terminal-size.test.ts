import { describe, expect, test } from "vite-plus/test";
import { sizeChanged, type TerminalSize } from "../../src/features/crew/terminal-size.ts";

describe("sizeChanged", () => {
  test("the first size is always news", () => {
    expect(sizeChanged(null, { cols: 100, rows: 29 })).toBe(true);
  });

  test("the same size again is not", () => {
    const last: TerminalSize = { cols: 100, rows: 29 };
    expect(sizeChanged(last, { cols: 100, rows: 29 })).toBe(false);
  });

  test("a change in either dimension is", () => {
    const last: TerminalSize = { cols: 100, rows: 29 };
    expect(sizeChanged(last, { cols: 101, rows: 29 })).toBe(true);
    expect(sizeChanged(last, { cols: 100, rows: 30 })).toBe(true);
  });
});
