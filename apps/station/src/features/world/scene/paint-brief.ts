import type { BriefInfo, CrewInfo } from "@mothership/protocol";

// The brief panel for a console's holo screen: the goal Claude plans to work toward, waiting on Y / N.

/** The panel replaces the terminal while a brief waits for the captain's answer. */
export function showsBriefPanel(
  brief: BriefInfo | undefined,
  _status: CrewInfo["status"] | undefined,
): boolean {
  return brief?.state === "waiting";
}

const BACKGROUND = "#04131d";
const TEXT = "#cfeaf2";
const DIM = "#4a6170";
const MONO = "ui-monospace, Menlo, monospace";
const MAX_LINES = 4;

/** Greedy word wrap to `maxWidth`, ending the last allowed line with an ellipsis if cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = words[i]!;
      if (lines.length === MAX_LINES) break;
    } else line = next;
  }
  if (lines.length < MAX_LINES && line) lines.push(line);
  if (lines.length === MAX_LINES && (line || words.length) && lines.join(" ") !== words.join(" ")) {
    let last = lines[MAX_LINES - 1]!;
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth)
      last = last.slice(0, -1);
    lines[MAX_LINES - 1] = `${last}…`;
  }
  return lines;
}

/** Paint `BRIEF · REV n`, the goal (up to 4 lines) and the answer keys. */
export function paintBrief(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  brief: BriefInfo,
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.05;
  const title = h / 11;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.font = `700 ${title}px ${MONO}`;
  ctx.fillStyle = TEXT;
  ctx.fillText(`BRIEF · REV ${brief.revision}`, pad, pad + title / 2);

  const body = h / 9;
  ctx.font = `${body}px ${MONO}`;
  const lines = wrap(ctx, brief.goal, w - pad * 2);
  const top = pad + title * 1.8;
  lines.forEach((line, i) => ctx.fillText(line, pad, top + i * body * 1.3 + body / 2));

  ctx.font = `700 ${title * 0.8}px ${MONO}`;
  ctx.fillStyle = DIM;
  ctx.fillText("Y approve · N revise", pad, h - pad - title / 2);
}
