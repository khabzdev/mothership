import { describe, expect, test } from "vite-plus/test";
import { parseReviseInput } from "../../src/features/briefs/model.ts";

describe("parseReviseInput", () => {
  test("passes the crew id and the trimmed reason on", () => {
    expect(parseReviseInput({ crewId: " c1 ", reason: "  use a map  " })).toEqual({
      crewId: "c1",
      reason: "use a map",
    });
  });

  test("rejects a blank, missing or non-string reason", () => {
    for (const reason of ["  ", "", undefined, 5]) {
      expect(() => parseReviseInput({ crewId: "c1", reason })).toThrow("Say what to change");
    }
  });

  test("rejects a reason over 500 characters", () => {
    expect(() => parseReviseInput({ crewId: "c1", reason: "x".repeat(501) })).toThrow(
      "Say what to change",
    );
    expect(parseReviseInput({ crewId: "c1", reason: "x".repeat(500) }).reason).toHaveLength(500);
  });

  test("still needs a crew id", () => {
    expect(() => parseReviseInput({ reason: "go" })).toThrow("crewId is required");
  });
});
