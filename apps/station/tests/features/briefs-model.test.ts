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

describe("goal heading edges", () => {
  test("a heading word that only starts with goal is not the Goal heading", () => {
    expect(goalOf("## Goals and scope\nShip it")).toBe("Goals and scope");
    expect(goalOf("## Goalkeeper\nShip it")).toBe("Goalkeeper");
  });

  test("plain Goal: line gives its text", () => {
    expect(goalOf("Goal: Ship it")).toBe("Ship it");
  });

  test("a Goal heading followed by another heading does not return that heading", () => {
    expect(goalOf("## Goal\n## Approach\nbody")).toBe("Goal");
  });
});
