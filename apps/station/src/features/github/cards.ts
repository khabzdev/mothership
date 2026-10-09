import type { BoardCard } from "../world/scene/Board";
import { issueColumn, pullColumn, type BoardData } from "./model";

const LABEL_COLORS: [RegExp, string][] = [
  [/bug|fix|crash/i, "#ffc2b3"],
  [/feat|enhance/i, "#c6e2ff"],
  [/doc/i, "#e4d4ff"],
  [/test/i, "#c8f2d5"],
];

const CHECK_DOTS = { pass: "#06d6a0", fail: "#ef476f", pending: "#ffd166", none: undefined };
const PULL_COLORS = {
  draft: "#dcdfe6",
  review: "#c6e2ff",
  approved: "#c8f2d5",
  merged: "",
  closed: "",
};

/** The Mission board's notes: the open issues nobody has taken yet (agent-office: they come off the wall once taken). */
export function missionCards(
  data: BoardData | undefined,
  carried?: number,
): { cards: BoardCard[]; note: string } {
  const issues = data?.issues ?? [];
  // The one in your hands is off the board.
  const open = issues.filter((i) => issueColumn(i) === "open" && i.number !== carried);
  const taken = issues.filter((i) => issueColumn(i) === "progress").length;
  return {
    cards: open.map((i) => ({
      key: String(i.number),
      label: `#${i.number}`,
      title: i.title,
      color: LABEL_COLORS.find(([re]) => i.labels.some((l) => re.test(l)))?.[1] ?? "#fff1b8",
    })),
    note: data?.error ? "GitHub unavailable" : `${open.length} open · ${taken} in progress`,
  };
}

/** The Launch board's cards: the pull requests still open, coloured by review, dotted by CI. */
export function launchCards(data: BoardData | undefined): { cards: BoardCard[]; note: string } {
  const pulls = data?.pulls ?? [];
  const open = pulls.filter((p) => p.state === "OPEN");
  const merged = pulls.filter((p) => p.state === "MERGED").length;
  return {
    cards: open.map((p) => ({
      key: String(p.number),
      label: `#${p.number}`,
      title: p.title,
      color: PULL_COLORS[pullColumn(p)],
      ...(CHECK_DOTS[p.checks] && { dot: CHECK_DOTS[p.checks] }),
    })),
    note: data?.error ? "GitHub unavailable" : `${open.length} open · ${merged} launched`,
  };
}
