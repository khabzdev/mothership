/** What went wrong on one mission, gathered for the debrief. */
export interface MissionEvidence {
  task: string;
  nogo: { checks: string[]; tails: string[] }[];
  flagged: { title: string; file?: string; why: string }[];
  revised: { goal: string; reason: string }[];
}

const TAIL_BYTES_EACH = 1_536;
const TAIL_BYTES_TOTAL = 4_096;
const SUMMARY_MAX = 140;

export function missionHadTrouble(e: MissionEvidence): boolean {
  return e.nogo.length > 0 || e.flagged.length > 0 || e.revised.length > 0;
}

/** `text` cut to at most `bytes` UTF-8 bytes, on a code point boundary. */
function cutBytes(text: string, bytes: number): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const size = Buffer.byteLength(ch);
    if (used + size > bytes) break;
    used += size;
    out += ch;
  }
  return out;
}

/** The evidence with output tails capped: 1.5 KB each, 4 KB across all. */
export function clipEvidence(e: MissionEvidence): MissionEvidence {
  let left = TAIL_BYTES_TOTAL;
  const nogo = e.nogo.map((run) => ({
    checks: run.checks,
    tails: run.tails.map((tail) => {
      const cut = cutBytes(tail, Math.min(TAIL_BYTES_EACH, left));
      left -= Buffer.byteLength(cut);
      return cut;
    }),
  }));
  return { ...e, nogo };
}

/** One line, at most 140 characters, saying what went wrong. */
export function evidenceSummary(e: MissionEvidence): string {
  const parts: string[] = [];
  const checks = [...new Set(e.nogo.flatMap((run) => run.checks))];
  if (checks.length) parts.push(`NO-GO: ${checks.join(", ")}`);
  if (e.flagged.length) parts.push(`Inspector: ${e.flagged.map((f) => f.title).join(", ")}`);
  if (e.revised.length)
    parts.push(`revised: ${e.revised.map((r) => r.reason || r.goal).join(", ")}`);
  const line = parts.join(" · ").replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > SUMMARY_MAX ? `${chars.slice(0, SUMMARY_MAX - 1).join("")}…` : line;
}
