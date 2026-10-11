import {
  FLAG_BOLD,
  FLAG_DIM,
  FLAG_INVERSE,
  RGB_FLAG,
  type Run,
  type ScreenFrame,
} from "@spaceship/protocol";

// Paints a crew terminal's screen onto a canvas for a console's holo screen: agent-office's
// paintScreen (features/workers/laptop.ts), in the deck's holo colours.

const BACKGROUND = "#04131d";
const FOREGROUND = "#cfeaf2";
const BASE16 = [
  "#0b1a24",
  "#ff5c7a",
  "#3ddc84",
  "#ffd166",
  "#5aa9ff",
  "#c792ea",
  "#5ce1e6",
  "#cfeaf2",
  "#4a6170",
  "#ff8199",
  "#7ef0ad",
  "#ffe08f",
  "#8cc4ff",
  "#ddb3f5",
  "#8ef0f3",
  "#ffffff",
];

const PALETTE: string[] = (() => {
  const p = [...BASE16];
  const steps = [0, 95, 135, 175, 215, 255];
  for (const r of steps)
    for (const g of steps) for (const b of steps) p.push(`rgb(${r},${g},${b})`);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p.push(`rgb(${v},${v},${v})`);
  }
  return p;
})();

function color(c: number, fallback: string): string {
  if (c < 0) return fallback;
  if (c >= RGB_FLAG) {
    const rgb = c & 0xffffff;
    return `rgb(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255})`;
  }
  return PALETTE[c] ?? fallback;
}

/** Terminal cells a run takes: one per code point (wide glyphs are rare in agent output). */
const cells = (text: string) => Array.from(text).length;
const runLen = (runs: Run[] | undefined) => (runs ? runs.reduce((n, r) => n + cells(r[0]), 0) : 0);
const CHAR_WIDTH = 0.6;
const LINE_HEIGHT = 1.25;
const MIN_ZOOM_ROWS = 12;
const MIN_ZOOM_COLS = 56;

/** The part of the terminal worth showing on a small screen: the recent rows, as big as they fit. */
function activeWindow(s: ScreenFrame, width: number, height: number, preferredRows: number) {
  let first = -1;
  let last = -1;
  let cols = MIN_ZOOM_COLS;
  for (let y = 0; y < s.rows; y++) {
    const runs = s.lines[y];
    if (!runs?.some((r) => r[0].trim() || r[2] !== -1)) continue;
    if (first < 0) first = y;
    last = y;
    cols = Math.max(cols, runLen(runs));
  }
  cols = Math.min(s.cols, cols);
  const aspectRows = Math.ceil((height * CHAR_WIDTH * cols) / (width * LINE_HEIGHT));
  const rows = Math.min(s.rows, Math.max(MIN_ZOOM_ROWS, preferredRows, aspectRows));
  const top = last < 0 ? 0 : Math.max(0, Math.min(last + 1 - rows, s.rows - rows));
  return {
    top,
    rows,
    cols,
    first: first < 0 ? top : Math.max(top, first),
    last: last < 0 ? top : Math.min(top + rows - 1, last),
  };
}

/** Paint `s` (or `placeholder` with no screen yet), zoomed in on its last `zoomRows` busy rows. */
export function paintScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: ScreenFrame | undefined,
  placeholder: string,
  zoomRows = 16,
): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  if (!s) {
    ctx.fillStyle = "#3f6a7d";
    ctx.font = `700 ${Math.round(h / 12)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(placeholder, w / 2, h / 2);
    ctx.textAlign = "left";
    return;
  }
  const pad = w * 0.03;
  const win = activeWindow(s, w - pad * 2, h - pad * 2, zoomRows);
  const cellW = (w - pad * 2) / win.cols;
  const cellH = (h - pad * 2) / win.rows;
  const fontSize = Math.max(4, Math.min(cellW / CHAR_WIDTH, cellH / LINE_HEIGHT));
  const charW = fontSize * CHAR_WIDTH;
  const lineH = fontSize * LINE_HEIGHT;
  const gridH = Math.max(1, win.last - win.first + 1) * lineH;
  const left = pad + (w - pad * 2 - win.cols * charW) / 2;
  const top = pad + (h - pad * 2 - gridH) / 2;
  ctx.textBaseline = "top";
  for (let y = 0; y < win.rows; y++) {
    const runs = s.lines[win.top + y];
    if (!runs) continue;
    let x = 0;
    const py = top + (win.top + y - win.first) * lineH;
    for (const [text, fgc, bgc, flags] of runs) {
      const len = cells(text);
      let fg = color(fgc, FOREGROUND);
      let bg = bgc < 0 ? null : color(bgc, BACKGROUND);
      if (flags & FLAG_INVERSE) [fg, bg] = [bg ?? BACKGROUND, fg];
      const px = left + x * charW;
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(px, py, len * charW + 0.5, lineH + 0.5);
      }
      if (text.trim()) {
        ctx.font = `${flags & FLAG_BOLD ? 700 : 400} ${fontSize}px ui-monospace, Menlo, monospace`;
        ctx.globalAlpha = flags & FLAG_DIM ? 0.55 : 1;
        ctx.fillStyle = fg;
        ctx.fillText(text, px, py + (lineH - fontSize) / 2);
        ctx.globalAlpha = 1;
      }
      x += len;
    }
  }
}
