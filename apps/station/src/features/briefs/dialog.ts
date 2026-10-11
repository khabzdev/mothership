import type { ScreenFrame } from "@spaceship/protocol";

export type Choice = "approve" | "revise";

type Option = { key: string; label: string };

const PROCEED = /would you like to proceed/i;
const OPTION = /^\s*(?:❯\s*)?(\d+)\.\s+(.*)$/;
const AUTO_ACCEPT = /auto-accept/i;
const CLEAR_CONTEXT = /clear context/i;
const KEEP_PLANNING = /keep planning/i;

/** One text per screen row: the row's run texts joined. */
export function screenLines(frame: ScreenFrame): string[] {
  return frame.lines.map((runs) => runs.map((run) => run[0]).join(""));
}

/** A header may wrap on a narrow terminal: it can span this many screen lines. */
const HEADER_SPAN = 3;

/** Whether a dialog header ends on line `end`: some run of lines ending there reads as one. */
function headerEndsAt(lines: string[], end: number): boolean {
  for (let span = 1; span <= HEADER_SPAN && span <= end + 1; span++) {
    const text = lines
      .slice(end - span + 1, end + 1)
      .map((line) => line.trim())
      .join(" ");
    if (PROCEED.test(text)) return true;
  }
  return false;
}

/** The line the last dialog header ends on, or -1 without one. */
function lastHeader(lines: string[]): number {
  let header = -1;
  for (let i = 0; i < lines.length; i++) {
    // A header's first line: the lines after it read as the header too, joined to it.
    if (headerEndsAt(lines, i) && (i === 0 || !headerEndsAt(lines, i - 1))) header = i;
  }
  return header;
}

/** True when Claude Code's plan-approval dialog is on screen. */
export function dialogShown(lines: string[]): boolean {
  return lastHeader(lines) !== -1;
}

/**
 * The option block directly under the last dialog header; blank lines may sit between options.
 * On a narrow terminal an option's label wraps: an indented line straight under an option goes
 * on its label. Any other line ends the block.
 */
function optionsUnder(lines: string[]): Option[] {
  const header = lastHeader(lines);
  if (header === -1) return [];
  const options: Option[] = [];
  let afterOption = false;
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === "") {
      afterOption = false;
      continue;
    }
    const m = OPTION.exec(line);
    if (m) {
      options.push({ key: m[1]!, label: m[2]! });
      afterOption = true;
      continue;
    }
    const last = options.at(-1);
    if (!last || !afterOption || !/^\s/.test(line)) break;
    last.label = `${last.label.trimEnd()} ${line.trim()}`;
  }
  return options;
}

/**
 * The plain auto-accept option. Never the clear-context variant: it throws the session's
 * context away, so with only that on screen nothing is picked.
 */
function approveOption(options: Option[]): Option | undefined {
  return options.find((o) => AUTO_ACCEPT.test(o.label) && !CLEAR_CONTEXT.test(o.label));
}

/** The number key of the dialog option for this choice, or null when it is not on screen. */
export function findOption(lines: string[], choice: Choice): string | null {
  const options = optionsUnder(lines);
  const picked =
    choice === "approve"
      ? approveOption(options)
      : options.find((o) => KEEP_PLANNING.test(o.label));
  return picked?.key ?? null;
}
