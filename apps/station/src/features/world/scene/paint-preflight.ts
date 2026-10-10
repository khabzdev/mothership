import type { CrewInfo, PreflightInfo } from "@mothership/protocol";

// The Go/No-Go panel for a console's holo screen, and the lamp states along its desk.

export type LampState = "off" | "running" | "go" | "nogo";

/**
 * One lamp per check slot. The first check without a verdict is `running` while the run is.
 * No info means "not run".
 */
export function lampStates(info: PreflightInfo | undefined, count: number): LampState[] {
  const lamps: LampState[] = Array.from({ length: count }, () => "off");
  if (!info) return lamps;
  let runningTaken = false;
  info.checks.slice(0, count).forEach((check, i) => {
    if (check.verdict === "go") lamps[i] = "go";
    else if (check.verdict === "nogo") lamps[i] = "nogo";
    else if (!check.verdict && info.state === "running" && !runningTaken) {
      lamps[i] = "running";
      runningTaken = true;
    }
  });
  return lamps;
}

/** The panel replaces the terminal while a run is on, or while its NO-GO waits for the hand-back. */
export function showsPreflightPanel(
  info: PreflightInfo | undefined,
  status: CrewInfo["status"] | undefined,
): boolean {
  if (!info) return false;
  return info.state === "running" || (info.state === "nogo" && status !== "working");
}

const BACKGROUND = "#04131d";
const TEXT = "#cfeaf2";
const DIM = "#4a6170";
const GO = "#3ddc84";
const NOGO = "#ff3b3b";
const RUNNING = "#ffc044";
const MONO = "ui-monospace, Menlo, monospace";

const mmss = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Paint the checks with GO / NO-GO, the elapsed time (if known), and a fuel row. */
export function paintPreflight(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  info: PreflightInfo,
  elapsedSec?: number,
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.05;
  const title = h / 11;
  const rowH = Math.min(h / 9, (h * 0.58) / Math.max(1, info.checks.length));
  ctx.textBaseline = "middle";

  ctx.font = `700 ${title}px ${MONO}`;
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.fillText(`PRE-FLIGHT · ATTEMPT ${info.attempt}`, pad, pad + title / 2);
  if (elapsedSec !== undefined && info.state === "running") {
    ctx.textAlign = "right";
    ctx.fillStyle = DIM;
    ctx.fillText(mmss(elapsedSec), w - pad, pad + title / 2);
  }

  const lamps = lampStates(info, info.checks.length);
  const top = pad + title * 1.8;
  info.checks.forEach((check, i) => {
    const y = top + i * rowH + rowH / 2;
    const lamp = lamps[i];
    const color = lamp === "go" ? GO : lamp === "nogo" ? NOGO : lamp === "running" ? RUNNING : DIM;
    const label =
      check.verdict === "go"
        ? "GO"
        : check.verdict === "nogo"
          ? "NO-GO"
          : check.verdict === "skipped"
            ? "SKIPPED"
            : lamp === "running"
              ? "RUNNING"
              : "WAITING";
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pad + rowH * 0.25, y, rowH * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${rowH * 0.6}px ${MONO}`;
    ctx.textAlign = "left";
    ctx.fillStyle = TEXT;
    ctx.fillText(check.name, pad + rowH * 0.8, y, w * 0.6);
    ctx.textAlign = "right";
    ctx.font = `700 ${rowH * 0.6}px ${MONO}`;
    ctx.fillStyle = color;
    ctx.fillText(label, w - pad, y);
  });

  // Fuel: one cell per hand-back, filled while it is left.
  const fuelY = h - pad - title / 2;
  ctx.font = `700 ${title * 0.8}px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillStyle = DIM;
  ctx.fillText("FUEL", pad, fuelY);
  const cellW = Math.min(w * 0.08, (w * 0.6) / Math.max(1, info.maxFuel));
  const x0 = pad + title * 3.2;
  for (let i = 0; i < info.maxFuel; i++) {
    ctx.fillStyle = i < info.fuel ? RUNNING : DIM;
    ctx.globalAlpha = i < info.fuel ? 1 : 0.35;
    ctx.fillRect(x0 + i * cellW * 1.15, fuelY - title * 0.4, cellW, title * 0.8);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "left";
}
