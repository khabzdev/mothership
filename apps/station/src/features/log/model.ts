/** A mission's id: its crew member and when it started, so the debrief can tag lessons before it's logged. */
export function missionId(crewId: string, startedAt: number): string {
  return `${crewId}:${startedAt}`;
}

/** How a mission came out: its pull request merged, still open or closed unmerged, or sent home. */
export type Outcome = "merged" | "open" | "closed" | "home";

export type VerdictKind = "clean" | "rework" | "open" | "home";

/** What the verdict is drawn from; `null` firsts mean no such run happened. */
export interface VerdictInput {
  outcome: Outcome;
  /** Brief revisions this mission (0 without a brief). */
  briefRevisions: number;
  /** NO-GO stop pre-flights. */
  nogos: number;
  /** Flagged stop inspections. */
  flags: number;
  /** Whether the first stop pre-flight was GO. */
  firstGo: boolean | null;
  /** Whether the first stop inspection cleared. */
  firstClear: boolean | null;
  /** The Inspector tried but no review could run (none cleared or flagged). */
  inspectorFailed: boolean;
}

/** The mission's verdict, one line: clean, shipped after rework, not merged, or sent home. */
export function missionVerdict(v: VerdictInput): { kind: VerdictKind; line: string } {
  const parts = [
    v.nogos > 0 && `${v.nogos} NO-GO`,
    v.flags > 0 && `flagged ${v.flags}×`,
    v.inspectorFailed && "Inspector couldn't run",
    v.briefRevisions > 1 && "brief revised",
  ]
    .filter((p): p is string => !!p)
    .join(" · ");
  switch (v.outcome) {
    case "merged":
      // Clean: nothing handed back, nothing revised, and every first try that ran passed.
      return !parts && v.firstGo !== false && v.firstClear !== false
        ? { kind: "clean", line: "Clean" }
        : {
            kind: "rework",
            line: parts ? `Shipped after rework: ${parts}` : "Shipped after rework",
          };
    case "open":
      return { kind: "open", line: "Not merged" };
    case "closed":
      return { kind: "open", line: "PR closed" };
    case "home":
      return { kind: "home", line: parts ? `Sent home: ${parts}` : "Sent home" };
  }
}
