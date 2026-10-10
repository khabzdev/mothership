import { describe, expect, test } from "vite-plus/test";
import { BRIEF_INSTRUCTIONS, GOAL_MAX, goalOf } from "../../src/features/briefs/model.ts";

describe("brief model", () => {
  test("instructions ask for the five headings", () => {
    expect(BRIEF_INSTRUCTIONS).toContain("Goal (one sentence");
    expect(BRIEF_INSTRUCTIONS).toContain("Not doing");
  });

  test("goal from the Goal heading's first line", () => {
    expect(goalOf("## Goal\nLogin survives an expired cookie.\n## Approach\n…")).toBe(
      "Login survives an expired cookie.",
    );
    expect(goalOf("**Goal**: Ship the toggle.\nApproach: …")).toBe("Ship the toggle.");
    expect(goalOf("Goal\n\nShip it")).toBe("Ship it");
  });

  test("no Goal heading: the first non-empty line, markdown stripped", () => {
    expect(goalOf("\n\n# Plan for dark mode\n- step")).toBe("Plan for dark mode");
    expect(goalOf("")).toBe("(empty brief)");
  });

  test("a long goal is clipped", () => {
    expect(goalOf(`## Goal\n${"x".repeat(300)}`)).toHaveLength(GOAL_MAX);
    expect(goalOf(`## Goal\n${"x".repeat(300)}`).endsWith("…")).toBe(true);
  });
});
