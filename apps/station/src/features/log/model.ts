/** How many missions the log lists at a time. */
export const LOG_PAGE = 30;

const asRecord = (input: unknown) =>
  (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

function requiredId(o: Record<string, unknown>, key: string): string {
  const value = typeof o[key] === "string" ? o[key].trim() : "";
  if (!value) throw new Error(`${key} is required`);
  return value;
}

/** Where the next page of the log starts: past this mission. */
export interface LogCursor {
  endedAt: number;
  id: string;
}

export function parseLogInput(input: unknown): { deckId: string; before?: LogCursor } {
  const o = asRecord(input);
  const deckId = requiredId(o, "deckId");
  if (o.before === undefined) return { deckId };
  const before = asRecord(o.before);
  if (typeof before.endedAt !== "number" || !Number.isFinite(before.endedAt))
    throw new Error("before.endedAt must be a number");
  return { deckId, before: { endedAt: before.endedAt, id: requiredId(before, "id") } };
}

export function parseMissionInput(input: unknown): { missionId: string } {
  return { missionId: requiredId(asRecord(input), "missionId") };
}

export function parseRunInput(input: unknown): { preflightId: string } {
  return { preflightId: requiredId(asRecord(input), "preflightId") };
}

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

/** How long ago a mission ended: "just now", "5m ago", "2h ago", "3d ago". */
export function endedAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
