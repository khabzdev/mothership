import { describe, expect, test } from "vite-plus/test";
import { statusOf } from "../../src/features/world/scene/status.ts";

describe("statusOf", () => {
  const brief = (state: "waiting" | "approved") => ({ revision: 1, state, goal: "g" });

  test("a waiting brief reads Brief ready, in the needs-you tone", () => {
    expect(statusOf({ kind: "agent", status: "needs_input", brief: brief("waiting") })).toEqual({
      label: "Brief ready",
      tone: "error",
    });
  });

  test("an approved brief, or none, still reads Needs you", () => {
    expect(statusOf({ kind: "agent", status: "needs_input", brief: brief("approved") }).label).toBe(
      "Needs you",
    );
    expect(statusOf({ kind: "agent", status: "needs_input" }).label).toBe("Needs you");
  });

  test("a waiting brief on a working crew member changes nothing", () => {
    expect(statusOf({ kind: "agent", status: "working", brief: brief("waiting") }).label).toBe(
      "Working",
    );
  });
});
