// Searching what's in the crew's terminals (agent-office's / search, terminals only).

export interface SearchHit {
  crewId: string;
  name: string;
  /** Line number in the terminal's history, from the top. */
  line: number;
  text: string;
}

const MAX_LINE = 240;

/** A terminal's output as plain lines: escape sequences gone, carriage returns resolved. */
export function plainLines(output: string): string[] {
  /* oxlint-disable no-control-regex -- terminal escapes are control characters */
  const text = output
    // OSC (title, hyperlinks) … BEL/ST, then CSI and other escapes.
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "");
  return text.split(/\r?\n/).map((line) => {
    // A bare \r rewrites the line from the start: keep what's left on screen.
    const parts = line.split("\r");
    const shown = parts.at(-1) || [...parts].reverse().find(Boolean) || "";
    return shown.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  });
  /* oxlint-enable no-control-regex */
}

/** Lines with every word of `query` in them (any case), last ones first, at most `limit`. */
export function findLines(
  lines: string[],
  query: string,
  limit = 20,
): { line: number; text: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: { line: number; text: string }[] = [];
  for (let i = lines.length - 1; i >= 0 && hits.length < limit; i--) {
    const lower = lines[i]!.toLowerCase();
    if (words.every((w) => lower.includes(w))) {
      hits.push({ line: i, text: lines[i]!.trim().slice(0, MAX_LINE) });
    }
  }
  return hits;
}

export function parseSearchInput(input: unknown): { deckId: string; query: string } {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const deckId = typeof o.deckId === "string" ? o.deckId : "";
  const query = typeof o.query === "string" ? o.query.trim().slice(0, 200) : "";
  if (!deckId) throw new Error("deckId is required");
  return { deckId, query };
}
