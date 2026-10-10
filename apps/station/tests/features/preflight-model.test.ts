import { describe, expect, test } from "vite-plus/test";
import { parseLogInput } from "../../src/features/preflight/model.ts";

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
