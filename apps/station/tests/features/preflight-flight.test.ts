import { describe, expect, test } from "vite-plus/test";
import { afterPreflight, afterVerdict, DEFAULT_FUEL } from "../../src/features/preflight/flight.ts";
import {
  handBackMessage,
  outOfFuelDetail,
  TAIL_BYTES,
  TAIL_LINES,
  tailOf,
} from "../../src/features/preflight/report.ts";

describe("afterPreflight", () => {
  test("all GO → go", () => {
    expect(afterPreflight(["go", "go"], DEFAULT_FUEL, 1)).toEqual({ kind: "go" });
  });

  test("any NO-GO with fuel → hand back attempt n+1 of fuel+attempt", () => {
    expect(afterPreflight(["go", "nogo"], 3, 1)).toEqual({
      kind: "handBack",
      attempt: 2,
      maxAttempts: 4,
    });
    expect(afterPreflight(["nogo"], 1, 3)).toEqual({
      kind: "handBack",
      attempt: 4,
      maxAttempts: 4,
    });
  });

  test("NO-GO on empty tank → out of fuel", () => {
    expect(afterPreflight(["nogo"], 0, 4)).toEqual({ kind: "outOfFuel", attempts: 4 });
  });

  test("an empty verdict list is never GO", () => {
    expect(afterPreflight([], 3, 1)).not.toEqual({ kind: "go" });
  });
});

describe("afterVerdict", () => {
  test("ok → go, whatever the tank", () => {
    expect(afterVerdict(true, 0, 3)).toEqual({ kind: "go" });
  });

  test("not ok with fuel → hand back attempt n+1 of fuel+attempt", () => {
    expect(afterVerdict(false, 2, 1)).toEqual({ kind: "handBack", attempt: 2, maxAttempts: 3 });
  });

  test("not ok on an empty tank → out of fuel", () => {
    expect(afterVerdict(false, 0, 4)).toEqual({ kind: "outOfFuel", attempts: 4 });
  });
});

describe("report", () => {
  test("handBackMessage matches the spec wording", () => {
    const message = handBackMessage(
      [
        {
          name: "check",
          command: "vp check",
          exitCode: 1,
          timedOut: false,
          timeoutMs: 300_000,
          durationMs: 12_400,
          tail: "src/a.ts: error",
        },
        {
          name: "test",
          command: "vp test",
          exitCode: null,
          timedOut: true,
          timeoutMs: 300_000,
          durationMs: 300_000,
          tail: "still waiting",
        },
      ],
      2,
      4,
    );
    expect(message).toBe(
      [
        "Pre-flight NO-GO (attempt 2 of 4). These checks failed in your worktree:",
        "",
        "✗ check  (`vp check`, exit 1, 12.4s)",
        "src/a.ts: error",
        "",
        "✗ test  (`vp test`, timed out after 5m, 300.0s)",
        "still waiting",
        "",
        "Fix them, then stop. The station re-runs every check when you stop.",
      ].join("\n"),
    );
  });

  test("outOfFuelDetail", () => {
    expect(outOfFuelDetail(["test"], 4)).toBe("Out of fuel: test still NO-GO after 4 attempts");
    expect(outOfFuelDetail(["check", "test"], 2)).toBe(
      "Out of fuel: check, test still NO-GO after 2 attempts",
    );
  });

  test("tails are plain text", () => {
    const tail = tailOf("\x1b[31mFAIL\x1b[0m src/a.test.ts\n50%\r100%\n");
    expect(tail).toContain("FAIL");
    expect(tail).toContain("100%");
    expect(tail).not.toContain("\x1b");
    expect(tail).not.toContain("50%");
  });

  test("tails keep the last 60 lines and 8 KB", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const tail = tailOf(lines.join("\n") + "\n");
    expect(tail.split("\n")).toEqual(lines.slice(-TAIL_LINES));

    const wide = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(2000)).join("\n");
    const cut = tailOf(wide);
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(TAIL_BYTES);
    expect(cut.endsWith("9".repeat(2000))).toBe(true);

    const multibyte = tailOf("é".repeat(TAIL_BYTES));
    expect(multibyte).toMatch(/^é+$/);
    expect(new TextEncoder().encode(multibyte).length).toBeLessThanOrEqual(TAIL_BYTES);
  });
});
