import { describe, expect, test } from "vite-plus/test";
import { briefPrompt, feedbackPrompt } from "../../src/features/missions/prompt.ts";

describe("briefPrompt", () => {
  test("lists the goal and acceptance criteria", () => {
    const prompt = briefPrompt({
      goal: "Add a dark mode toggle",
      criteria: [
        { id: "a", kind: "command", command: "vp test" },
        { id: "b", kind: "manual", label: "Toggle looks right" },
      ],
    });
    expect(prompt).toBe(
      [
        "Mission: Add a dark mode toggle",
        "",
        "Acceptance criteria (the station checks these after you stop):",
        "1. `vp test` passes",
        "2. Toggle looks right (checked by a human)",
        "",
        "Work in this directory. Commit nothing; the station commits and opens the PR. Stop when the mission is done.",
      ].join("\n"),
    );
  });
});

describe("feedbackPrompt", () => {
  test("reports NO-GO criteria with their output", () => {
    const prompt = feedbackPrompt(
      [{ id: "a", kind: "command", command: "vp test" }],
      [{ criterionId: "a", verdict: "nogo", output: "FAIL src/a.test.ts" }],
    );
    expect(prompt).toContain("Pre-flight: NO-GO");
    expect(prompt).toContain("`vp test`");
    expect(prompt).toContain("FAIL src/a.test.ts");
  });

  test("keeps only the tail of long output", () => {
    const prompt = feedbackPrompt(
      [{ id: "a", kind: "command", command: "vp test" }],
      [{ criterionId: "a", verdict: "nogo", output: `${"x".repeat(10_000)}END` }],
    );
    expect(prompt.length).toBeLessThan(5000);
    expect(prompt).toContain("END");
  });
});
