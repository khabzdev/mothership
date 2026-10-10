import { describe, expect, test } from "vite-plus/test";
import type { PreflightInfo } from "@mothership/protocol";
import { parseLogInput, preflightChip } from "../../src/features/preflight/model.ts";

describe("pre-flight log input", () => {
  test("parseLogInput rejects path tricks", () => {
    expect(parseLogInput({ preflightId: "abc-123", checkId: "lint_1" })).toEqual({
      preflightId: "abc-123",
      checkId: "lint_1",
    });
    expect(() => parseLogInput({ preflightId: "abc", checkId: "../x" })).toThrow();
    expect(() => parseLogInput({ preflightId: "../abc", checkId: "x" })).toThrow();
    expect(() => parseLogInput({ preflightId: "a/b", checkId: "x" })).toThrow();
    expect(() => parseLogInput({ preflightId: "abc", checkId: "" })).toThrow();
    expect(() => parseLogInput({ preflightId: "abc" })).toThrow();
  });
});

describe("preflightChip", () => {
  const info = (over: Partial<PreflightInfo>): PreflightInfo => ({
    state: "go",
    checks: [],
    attempt: 1,
    fuel: 3,
    maxFuel: 3,
    ...over,
  });

  test("shows nothing when there is no pre-flight", () => {
    expect(preflightChip(undefined)).toBeNull();
  });

  test("shows a manual-only run (attempt 0)", () => {
    expect(preflightChip(info({ attempt: 0, state: "go" }))).toEqual({
      label: "GO",
      tone: "success",
    });
  });

  test("warns while running", () => {
    expect(preflightChip(info({ state: "running" }))).toEqual({
      label: "Pre-flight…",
      tone: "warning",
    });
  });

  test("says GO on success", () => {
    expect(preflightChip(info({ state: "go" }))).toEqual({ label: "GO", tone: "success" });
  });

  test("says NO-GO with the fuel left", () => {
    expect(preflightChip(info({ state: "nogo", fuel: 1, maxFuel: 3 }))).toEqual({
      label: "NO-GO · fuel 1/3",
      tone: "error",
    });
  });
});
