/** Rank titles and the points each starts at. */
export const RANKS = [
  ["Cadet", 0],
  ["Ensign", 5],
  ["Lieutenant", 15],
  ["Commander", 35],
  ["Captain", 70],
] as const;

export type RankTitle = (typeof RANKS)[number][0];

/** One call sign's service record on one deck. */
export interface ServiceCounters {
  missions: number;
  merged: number;
  firstTryGo: number;
  firstTryClear: number;
  cleanBriefs: number;
  lessonsKept: number;
}

export function pointsOf(c: ServiceCounters): number {
  return 3 * c.merged + c.firstTryGo + c.firstTryClear + c.cleanBriefs;
}

/** The rank for `points`, and the points at which the next rank starts (absent at Captain). */
export function rankOf(points: number): { title: RankTitle; points: number; next?: number } {
  let index = 0;
  RANKS.forEach(([, from], i) => {
    if (points >= from) index = i;
  });
  const next = RANKS[index + 1];
  return next
    ? { title: RANKS[index]![0], points, next: next[1] }
    : { title: RANKS[index]![0], points };
}

export type PatchId =
  | "first-launch"
  | "clean-sheet"
  | "steady-hand"
  | "sharpshooter"
  | "old-hand"
  | "teacher";

export const PATCHES: { id: PatchId; name: string; rule: string }[] = [
  { id: "first-launch", name: "First Launch", rule: "1 merged PR" },
  { id: "clean-sheet", name: "Clean Sheet", rule: "a mission with no rework" },
  { id: "steady-hand", name: "Steady Hand", rule: "5 first-try GOs" },
  { id: "sharpshooter", name: "Sharpshooter", rule: "5 first-try clear inspections" },
  { id: "old-hand", name: "Old Hand", rule: "10 merged PRs" },
  { id: "teacher", name: "Teacher", rule: "1 lesson kept" },
];

/** Patches earned now and not already held, in PATCHES order. */
export function newPatches(
  c: ServiceCounters,
  have: PatchId[],
  mission?: { cleanSheet: boolean },
): PatchId[] {
  const earned: Record<PatchId, boolean> = {
    "first-launch": c.merged >= 1,
    "clean-sheet": mission?.cleanSheet === true,
    "steady-hand": c.firstTryGo >= 5,
    sharpshooter: c.firstTryClear >= 5,
    "old-hand": c.merged >= 10,
    teacher: c.lessonsKept >= 1,
  };
  return PATCHES.filter((p) => earned[p.id] && !have.includes(p.id)).map((p) => p.id);
}
