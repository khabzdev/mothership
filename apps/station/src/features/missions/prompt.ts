import type { Brief, Criterion, CriterionResult } from "@mothership/mission-engine";

const MAX_OUTPUT = 4000;

function describe(criterion: Criterion): string {
  return criterion.kind === "command"
    ? `\`${criterion.command}\` passes`
    : `${criterion.label} (checked by a human)`;
}

/** The Engineer's opening prompt for a mission. */
export function briefPrompt(brief: Brief): string {
  return [
    `Mission: ${brief.goal}`,
    "",
    "Acceptance criteria (the station checks these after you stop):",
    ...brief.criteria.map((c, i) => `${i + 1}. ${describe(c)}`),
    "",
    "Work in this directory. Commit nothing; the station commits and opens the PR. Stop when the mission is done.",
  ].join("\n");
}

/** What the Engineer is told after a NO-GO pre-flight. */
export function feedbackPrompt(criteria: Criterion[], failures: CriterionResult[]): string {
  const lines = ["Pre-flight: NO-GO. Fix these and stop again when done:", ""];
  for (const failure of failures) {
    const criterion = criteria.find((c) => c.id === failure.criterionId);
    lines.push(`- ${criterion ? describe(criterion) : failure.criterionId}`);
    if (failure.output) {
      const output =
        failure.output.length > MAX_OUTPUT
          ? `…${failure.output.slice(-MAX_OUTPUT)}`
          : failure.output;
      lines.push("```", output.trimEnd(), "```");
    }
  }
  return lines.join("\n");
}
