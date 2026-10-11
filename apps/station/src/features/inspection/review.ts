import { MAX_FINDINGS, TITLE_MAX, type Finding } from "./model";

/** The most diff, in bytes, that goes into the review prompt. */
export const DIFF_CAP_BYTES = 60_000;

const UNREADABLE: Finding = {
  severity: "note",
  source: "review",
  title: "Inspector's report was unreadable",
  why: "The review ran but its answer couldn't be parsed, so nothing was checked.",
};

/** The diff cut to DIFF_CAP_BYTES, and whether anything was cut. */
function clipDiff(diff: string): { text: string; clipped: boolean } {
  const bytes = Buffer.from(diff);
  if (bytes.length <= DIFF_CAP_BYTES) return { text: diff, clipped: false };
  const text = bytes.subarray(0, DIFF_CAP_BYTES).toString().replace(/�+$/, "");
  return { text, clipped: true };
}

/** The prompt for the Inspector's review of one change. */
export function reviewPrompt(input: {
  brief: string | null;
  task: string;
  checks: { name: string; verdict: string }[];
  scope: Finding[];
  diff: string;
}): string {
  const { text, clipped } = clipDiff(input.diff);
  const parts = [
    "You are the Inspector: review another engineer's change; you did not write it. You may read files with your tools but must not change anything.",
    input.brief !== null
      ? `Approved brief:\n\n${input.brief.trim()}`
      : `Task (no approved brief):\n\n${input.task.trim()}`,
    "Pre-flight results:\n" +
      (input.checks.length
        ? input.checks.map((c) => `- ${c.name}: ${c.verdict}`).join("\n")
        : "- none ran"),
    "Scope findings:\n" +
      (input.scope.length
        ? input.scope.map((f) => `- ${f.severity}: ${f.title}`).join("\n")
        : "- none"),
    "Report a blocker only when: the change doesn't do what the brief's Goal says; something under the brief's Not doing was done; there is a likely bug or breakage elsewhere; or it contains secrets or destructive operations. Everything else is a note.",
    `Answer with one fenced json block and nothing after it, shaped like this. At most ${MAX_FINDINGS} findings, titles under ${TITLE_MAX} characters; an empty list is fine.\n\n\`\`\`json\n{"findings":[{"severity":"blocker or note","file":"path","line":12,"title":"...","why":"..."}]}\n\`\`\``,
    `Diff:\n\n${text}` +
      (clipped
        ? `\n\n[The diff was clipped to ${DIFF_CAP_BYTES} bytes; read the full files with your tools if you need more.]`
        : ""),
  ];
  return parts.join("\n\n");
}

/** The first value that parses from the model's text: last fenced block first, else the whole text. */
export function extractJson(text: string): unknown {
  const blocks = [...text.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)].map((m) => m[1]!);
  for (const body of [...blocks.reverse(), text]) {
    try {
      return JSON.parse(body.trim());
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

// Findings are typed into the agent's terminal inside a bracketed paste: no control characters
// (an escape could end the paste), and no line breaks except within `why`.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
const text = (value: unknown, lines = false): string => {
  if (typeof value !== "string") return "";
  const clean = value.replace(CONTROL, " ");
  return (lines ? clean : clean.replace(/\s+/g, " ")).trim();
};

/** `value` cut to `max` characters, ellipsis included; counts code points so an emoji isn't halved. */
export function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

function toFinding(raw: unknown): Finding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.severity !== "blocker" && o.severity !== "note") return null;
  const title = text(o.title);
  if (!title) return null;
  const finding: Finding = {
    severity: o.severity,
    source: "review",
    title: clip(title, TITLE_MAX),
    why: text(o.why, true),
  };
  const file = text(o.file);
  if (file) finding.file = file;
  if (finding.file && typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0) {
    finding.line = o.line;
  }
  return finding;
}

const FAILURE_MAX = 200;

/**
 * Why a `claude -p --output-format json` run couldn't review (an auth, credit or max-turns error,
 * which still exits 0): its envelope's `is_error`, or a `subtype` other than "success". Null when
 * it ran, or the output isn't an envelope at all.
 */
export function reviewFailure(stdout: string): string | null {
  let envelope: { is_error?: unknown; subtype?: unknown; result?: unknown };
  try {
    envelope = JSON.parse(stdout) as typeof envelope;
  } catch {
    return null;
  }
  if (typeof envelope !== "object" || envelope === null) return null;
  const subtype = typeof envelope.subtype === "string" ? envelope.subtype : undefined;
  if (envelope.is_error !== true && (subtype === undefined || subtype === "success")) return null;
  const text =
    (typeof envelope.result === "string" && envelope.result.trim()) ||
    (subtype !== "success" && subtype) ||
    "the review reported an error";
  return clip(text, FAILURE_MAX);
}

/** The `result` text of a `claude -p --output-format json` envelope; null when it has none. */
export function resultText(stdout: string): string | null {
  try {
    const result = (JSON.parse(stdout) as { result?: unknown }).result;
    return typeof result === "string" ? result : null;
  } catch {
    return null;
  }
}

/** The findings in `claude -p --output-format json` output; unreadable output is one note. */
export function parseReview(stdout: string): Finding[] {
  let result: unknown;
  try {
    result = (JSON.parse(stdout) as { result?: unknown }).result;
  } catch {
    return [{ ...UNREADABLE }];
  }
  if (typeof result !== "string") return [{ ...UNREADABLE }];
  const parsed = extractJson(result);
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { findings?: unknown } | undefined)?.findings;
  if (!Array.isArray(list)) return [{ ...UNREADABLE }];
  return list
    .map(toFinding)
    .filter((f): f is Finding => f !== null)
    .slice(0, MAX_FINDINGS);
}
