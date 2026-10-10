import type { ScreenFrame } from "@mothership/protocol";

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

/** True when Claude Code's plan-approval dialog is on screen. */
export function dialogShown(lines: string[]): boolean {
  return lines.some((line) => PROCEED.test(line));
}

/** The option block directly under the last dialog header; blank lines may sit between options. */
function optionsUnder(lines: string[]): Option[] {
  let header = -1;
  lines.forEach((line, i) => {
    if (PROCEED.test(line)) header = i;
  });
  if (header === -1) return [];
  const options: Option[] = [];
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === "") continue;
    const m = OPTION.exec(line);
    if (!m) break;
    options.push({ key: m[1]!, label: m[2]! });
  }
  return options;
}

/** The plain auto-accept option, avoiding the clear-context variant when one exists. */
function approveOption(options: Option[]): Option | undefined {
  const autos = options.filter((o) => AUTO_ACCEPT.test(o.label));
  return autos.find((o) => !CLEAR_CONTEXT.test(o.label)) ?? autos[0];
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
