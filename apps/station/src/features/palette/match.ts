// How well a query matches an entry (agent-office's palette): words, word starts and scattered
// letters all match, best first. 0 means no match.

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

/** Letters of `needle` appear in `hay` in order: how tightly (1 tight, towards 0 spread out). */
function scattered(needle: string, hay: string): number {
  let at = -1;
  let first = -1;
  for (const ch of needle) {
    at = hay.indexOf(ch, at + 1);
    if (at < 0) return 0;
    if (first < 0) first = at;
  }
  return needle.length / (at - first + 1);
}

/** The first letter of each word: "lb" for "Launch board". */
const initials = (s: string) =>
  s
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("");

/** Score `text` (and `extra`, less) against `query`. */
export function matchScore(query: string, text: string, extra = ""): number {
  const q = norm(query).trim();
  if (!q) return 1;
  const hay = norm(text);
  const more = norm(extra);
  const words = q.split(/\s+/);
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const [field, weight] of [
      [hay, 1],
      [more, 0.6],
    ] as const) {
      if (!field) continue;
      const i = field.indexOf(word);
      if (i === 0) best = Math.max(best, 10 * weight);
      else if (i > 0 && /[^a-z0-9]/.test(field[i - 1]!)) best = Math.max(best, 8 * weight);
      else if (i > 0) best = Math.max(best, 5 * weight);
      else if (initials(field).startsWith(word) && word.length > 1)
        best = Math.max(best, 7 * weight);
      else {
        const s = scattered(word, field);
        if (s > 0.25) best = Math.max(best, 3 * s * weight);
      }
    }
    if (!best) return 0;
    total += best;
  }
  // A shorter title that matches is a better match.
  return total / words.length + 1 / (1 + hay.length / 40);
}

/** The entries that match, best first; all of them, in order, for an empty query. */
export function rank<T>(query: string, entries: T[], text: (e: T) => [string, string?]): T[] {
  if (!query.trim()) return entries;
  return entries
    .map((e, i) => ({ e, i, s: matchScore(query, ...text(e)) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((r) => r.e);
}
