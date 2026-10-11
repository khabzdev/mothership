import { extractJson, resultText, reviewFailure } from "../inspection/review";
import { clipEvidence, type MissionEvidence } from "./evidence";
import { cleanLesson } from "./model";

const MAX_DRAFTED = 2;

/** The prompt for the debrief officer's look back at one mission. */
export function debriefPrompt(e: MissionEvidence, kept: string[]): string {
  const ev = clipEvidence(e);
  const sections: string[] = [`Task:\n${ev.task.trim()}`];
  if (ev.nogo.length) {
    sections.push(
      "Pre-flight NO-GO runs:\n" +
        ev.nogo
          .map((run) => `- failed: ${run.checks.join(", ")}\n${run.tails.join("\n")}`.trimEnd())
          .join("\n"),
    );
  }
  if (ev.flagged.length) {
    sections.push(
      "Inspector findings:\n" +
        ev.flagged
          .map((f) => `- ${f.title}${f.file ? ` (${f.file})` : ""}: ${f.why}`.trimEnd())
          .join("\n"),
    );
  }
  if (ev.revised.length) {
    sections.push(
      "Revised briefs:\n" + ev.revised.map((r) => `- ${r.goal}: ${r.reason}`).join("\n"),
    );
  }
  return [
    "You are the station's debrief officer. From what went wrong on this mission, write 0 to 2 lessons a future engineer on this repo should follow to avoid it. Each is one imperative sentence under 140 characters, specific to this repo (commands, paths, conventions), not generic advice.",
    kept.length
      ? `Lessons already kept (don't repeat them):\n${kept.map((l) => `- ${l}`).join("\n")}`
      : "No lessons are kept yet.",
    ...sections,
    'Answer with one fenced `json` block and nothing after it:\n\n```json\n{ "lessons": ["..."] }\n```',
  ].join("\n\n");
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The drafted lessons in `claude -p --output-format json` output, or why it couldn't run. */
export function parseDebrief(
  stdout: string,
  kept: string[],
): { lessons: string[] } | { failed: string } {
  const failed = reviewFailure(stdout);
  if (failed !== null) return { failed };
  const result = resultText(stdout);
  const parsed = result === null ? undefined : extractJson(result);
  const list = (parsed as { lessons?: unknown } | undefined)?.lessons;
  if (!Array.isArray(list)) return { lessons: [] };
  const seen = new Set(kept.map(norm));
  const lessons: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const lesson = cleanLesson(item);
    if (!lesson || seen.has(norm(lesson))) continue;
    seen.add(norm(lesson));
    lessons.push(lesson);
  }
  return { lessons: lessons.slice(0, MAX_DRAFTED) };
}
