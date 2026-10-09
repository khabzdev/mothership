import type headless from "@xterm/headless";
import {
  FLAG_BOLD,
  FLAG_DIM,
  FLAG_INVERSE,
  RGB_FLAG,
  type Run,
  type ScreenFrame,
} from "./protocol.ts";

/**
 * The visible screen of a headless terminal as styled runs per row (agent-office's snapshotScreen),
 * for painting onto a console's holo screen. Trailing default-styled blanks are trimmed.
 */
export function readScreen(term: headless.Terminal): ScreenFrame {
  const buf = term.buffer.active;
  const cell = buf.getNullCell();
  const lines: Run[][] = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const runs: Run[] = [];
    let cur: Run | null = null;
    for (let x = 0; line && x < term.cols; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      const ch = cell.getChars() || " ";
      const fg = cell.isFgDefault()
        ? -1
        : cell.isFgRGB()
          ? RGB_FLAG | cell.getFgColor()
          : cell.getFgColor();
      const bg = cell.isBgDefault()
        ? -1
        : cell.isBgRGB()
          ? RGB_FLAG | cell.getBgColor()
          : cell.getBgColor();
      const flags =
        (cell.isBold() ? FLAG_BOLD : 0) |
        (cell.isInverse() ? FLAG_INVERSE : 0) |
        (cell.isDim() ? FLAG_DIM : 0);
      if (cur && cur[1] === fg && cur[2] === bg && cur[3] === flags) cur[0] += ch;
      else runs.push((cur = [ch, fg, bg, flags]));
    }
    while (runs.length) {
      const r = runs[runs.length - 1]!;
      if (r[2] !== -1 || r[3] & FLAG_INVERSE) break;
      const trimmed = r[0].replace(/\s+$/, "");
      if (trimmed) {
        r[0] = trimmed;
        break;
      }
      runs.pop();
    }
    lines.push(runs);
  }
  return { cols: term.cols, rows: term.rows, lines };
}
