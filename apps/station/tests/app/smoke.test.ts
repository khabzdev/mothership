import { describe, expect, test } from "vite-plus/test";
import { parseSmokeFile, smokeStatus, type SmokeFile } from "../../src/app/smoke.ts";

const NOW = 1_000_000_000_000;
const file = (over: Partial<SmokeFile> = {}): SmokeFile => ({
  ranAt: NOW - 2 * 86_400_000,
  claudeVersion: "2.1.104",
  ghVersion: null,
  model: "haiku",
  checks: [
    { id: "claude.version", state: "passed", detail: "2.1.104" },
    { id: "gh.list", state: "skipped", detail: "SMOKE_GH_REPO not set" },
  ],
  ...over,
});

describe("smokeStatus", () => {
  test("no file is none", () => {
    expect(smokeStatus(null, "2.1.104", NOW)).toMatchObject({
      state: "none",
      line: "No smoke run yet",
    });
  });

  test("a file without checks is none", () => {
    expect(smokeStatus(file({ checks: [] }), "2.1.104", NOW)).toMatchObject({
      state: "none",
      line: "No smoke run yet",
      checks: [],
    });
  });

  test("passed shows the age and version; skipped never fails", () => {
    const s = smokeStatus(file(), "2.1.104", NOW);
    expect(s.state).toBe("passed");
    expect(s.line).toBe("Smoke passed 2d ago · Claude Code 2.1.104");
    expect(s.failed).toEqual([]);
  });

  test("ages: just now, minutes, hours", () => {
    const line = (ms: number) => smokeStatus(file({ ranAt: NOW - ms }), "2.1.104", NOW).line;
    expect(line(30_000)).toBe("Smoke passed just now · Claude Code 2.1.104");
    expect(line(5 * 60_000)).toBe("Smoke passed 5m ago · Claude Code 2.1.104");
    expect(line(3 * 3_600_000)).toBe("Smoke passed 3h ago · Claude Code 2.1.104");
  });

  test("failed counts checks, singular and plural", () => {
    const bad = { id: "a", state: "failed", detail: "x" } as const;
    const one = smokeStatus(file({ checks: [bad] }), "2.1.104", NOW);
    expect(one.line).toBe("Smoke failed: 1 check");
    expect(one.failed).toEqual([bad]);
    const two = smokeStatus(file({ checks: [bad, { ...bad, id: "b" }] }), "2.1.104", NOW);
    expect(two.line).toBe("Smoke failed: 2 checks");
  });

  test("stale only when both versions are known and differ", () => {
    expect(smokeStatus(file(), "2.2.0", NOW)).toMatchObject({
      state: "stale",
      line: "Claude Code changed since smoke (2.1.104 → 2.2.0)",
    });
    expect(smokeStatus(file(), null, NOW).state).toBe("passed");
    expect(smokeStatus(file({ claudeVersion: null }), "2.2.0", NOW).state).toBe("passed");
  });

  test("failed wins over stale", () => {
    const checks = [{ id: "a", state: "failed", detail: "x" } as const];
    expect(smokeStatus(file({ checks }), "9.9.9", NOW).state).toBe("failed");
  });
});

describe("parseSmokeFile", () => {
  test("accepts what the suite writes", () => {
    expect(parseSmokeFile(JSON.stringify(file()))).toEqual(file());
  });

  test.each([
    ["bad json", "{"],
    ["empty object", "{}"],
    ["checks not an array", JSON.stringify({ ...file(), checks: "x" })],
    [
      "bogus state",
      JSON.stringify({ ...file(), checks: [{ id: "a", state: "bogus", detail: "" }] }),
    ],
    ["missing detail", JSON.stringify({ ...file(), checks: [{ id: "a", state: "passed" }] })],
    ["ranAt as string", JSON.stringify({ ...file(), ranAt: "yesterday" })],
    ["array", "[]"],
    ["null", "null"],
  ])("%s is null", (_name, text) => {
    expect(parseSmokeFile(text)).toBeNull();
  });
});
