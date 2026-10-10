/** A terminal's grid, as sent in `terminal.resize`. */
export type TerminalSize = { cols: number; rows: number };

/** Whether `next` is worth telling the server about: the first size, or a different one. */
export function sizeChanged(last: TerminalSize | null, next: TerminalSize): boolean {
  return !last || last.cols !== next.cols || last.rows !== next.rows;
}
