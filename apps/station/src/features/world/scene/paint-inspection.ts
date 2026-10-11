import type { CrewStatus, InspectionInfo } from "@spaceship/protocol";

// The Inspector's panel for a console's holo screen: scanning, or its verdict.

/** The panel shows while a review runs, and its verdict once the crew member stops working. */
export function showsInspectionPanel(
  info: InspectionInfo | undefined,
  status: CrewStatus | undefined,
): boolean {
  if (!info) return false;
  if (info.state === "running") return true;
  return (info.state === "cleared" || info.state === "flagged") && status !== "working";
}

const BACKGROUND = "#04131d";
const TEXT = "#cfeaf2";
const DIM = "#4a6170";
const SCANNING = "#4de8ff";
const CLEARED = "#3ddc84";
const FLAGGED = "#ff3b3b";
const MONO = "ui-monospace, Menlo, monospace";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Cut `text` to `maxWidth`, ending it with an ellipsis if it was cut. */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Paint `INSPECTION`, the state or verdict (with the first blocker's title) and, at the console, the I key. */
export function paintInspection(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  info: InspectionInfo,
  atConsole: boolean,
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.05;
  const title = h / 11;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  ctx.font = `700 ${title}px ${MONO}`;
  ctx.fillStyle = TEXT;
  ctx.fillText("INSPECTION", pad, pad + title / 2);

  const body = h / 7;
  const top = pad + title * 2.2 + body / 2;
  ctx.font = `700 ${body}px ${MONO}`;
  if (info.state === "running") {
    ctx.fillStyle = info.queued ? DIM : SCANNING;
    ctx.fillText(info.queued ? "Queued…" : "Scanning…", pad, top);
  } else if (info.state === "cleared") {
    ctx.fillStyle = CLEARED;
    ctx.fillText(info.notes ? `Cleared · ${count(info.notes, "note")}` : "Cleared", pad, top);
  } else if (info.state === "flagged") {
    ctx.fillStyle = FLAGGED;
    ctx.fillText(`Flagged · ${count(info.blockers, "blocker")}`, pad, top);
    if (info.firstBlocker) {
      ctx.font = `${h / 11}px ${MONO}`;
      ctx.fillStyle = TEXT;
      ctx.fillText(fit(ctx, info.firstBlocker, w - pad * 2), pad, top + body * 1.2);
    }
  }

  if (atConsole) {
    ctx.font = `700 ${title * 0.8}px ${MONO}`;
    ctx.fillStyle = DIM;
    ctx.fillText("I report", pad, h - pad - title / 2);
  }
}
