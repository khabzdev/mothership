import type { BoardCard } from "../world/scene/Board";
import type { MissionSummary } from "./log.server";
import type { VerdictKind } from "./model";

/** How many missions the board's face shows: 2 columns of 2. */
const SHOWN = 4;

/** The boards' colours: clean green, rework amber, open dim, home red. */
const KIND_COLORS: Record<VerdictKind, { color: string; dot: string }> = {
  clean: { color: "#c8f2d5", dot: "#06d6a0" },
  rework: { color: "#fff1b8", dot: "#ffd166" },
  open: { color: "#dcdfe6", dot: "#8d99ae" },
  home: { color: "#ffc2b3", dot: "#ef476f" },
};

/** The Captain's log board: the newest missions, each its call sign and verdict. */
export function logCards(summaries: MissionSummary[]): BoardCard[] {
  return summaries.slice(0, SHOWN).map((m) => ({
    key: m.id,
    label: m.name,
    title: m.verdict.line,
    ...KIND_COLORS[m.verdict.kind],
  }));
}
