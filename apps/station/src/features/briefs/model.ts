/** The text appended to Claude's system prompt: a brief is written and submitted before any edit. */
export const BRIEF_INSTRUCTIONS =
  "Before you change anything, write a brief as your plan, under 25 lines, with exactly these headings: Goal (one sentence: what will be true when you're done), Approach, Files (the ones you expect to touch), Proof (the checks or tests that will show it works), Not doing (what's out of scope). Then submit it for approval.";

/** The longest goal shown, ellipsis included. */
export const GOAL_MAX = 120;

const EMPTY = "(empty brief)";

// Each pattern matches a Goal heading line; group 1 is any text on that same line.
const GOAL_LINES = [
  /^\s*#{1,6}\s*goal\s*:?\s*(.*)$/i,
  /^\s*\*\*goal\*\*\s*:?\s*(.*)$/i,
  /^\s*goal\s*:?\s*$/i,
];

/** The same-line text of a Goal heading ("" when none), or null when the line is not one. */
function goalHeading(line: string): string | null {
  for (const re of GOAL_LINES) {
    const m = re.exec(line);
    if (m) return (m[1] ?? "").trim();
  }
  return null;
}

/** A line's text with leading markdown markers and bold asterisks removed. */
function clean(line: string): string {
  return line
    .replace(/^(?:\s|#|-|\*|>)+/, "")
    .replace(/\*\*/g, "")
    .trim();
}

/** The first non-empty line at or after `from`, cleaned. */
function firstText(lines: string[], from: number): string {
  for (let i = from; i < lines.length; i++) {
    const text = clean(lines[i]!);
    if (text) return text;
  }
  return "";
}

/** Clips to GOAL_MAX characters, ending in an ellipsis when cut. */
function clip(text: string): string {
  return text.length > GOAL_MAX ? `${text.slice(0, GOAL_MAX - 1)}…` : text;
}

/** The brief's goal: the text under its Goal heading, else its first line. */
export function goalOf(text: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => goalHeading(line) !== null);
  const found =
    at === -1 ? firstText(lines, 0) : goalHeading(lines[at]!) || firstText(lines, at + 1);
  return clip(found || EMPTY);
}
