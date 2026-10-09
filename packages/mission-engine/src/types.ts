export const MISSION_STATES = [
  "briefing",
  "building",
  "preflight",
  "launching",
  "launched",
  "redAlert",
] as const;

export type MissionState = (typeof MISSION_STATES)[number];

export type Criterion =
  | { id: string; kind: "command"; command: string }
  | { id: string; kind: "manual"; label: string };

export interface Brief {
  goal: string;
  criteria: Criterion[];
}

export interface CriterionResult {
  criterionId: string;
  verdict: "go" | "nogo";
  output?: string;
}

export interface Alert {
  reason: "needsInput" | "crashed" | "launchFailed";
  detail: string;
}

export interface Mission {
  state: MissionState;
  brief: Brief;
  /** Build attempts so far, including NO-GO rebuilds. */
  attempts: number;
  lastPreflight?: CriterionResult[];
  alert?: Alert;
  /** State to return to when a red alert is resolved. */
  resumeTo?: MissionState;
  prUrl?: string;
}

export type MissionEvent =
  | { type: "launchCrew" }
  | { type: "crewStopped" }
  | { type: "crewNeedsInput"; detail: string }
  | { type: "crewCrashed"; detail: string }
  | { type: "preflightFinished"; results: CriterionResult[] }
  | { type: "launchSucceeded"; prUrl: string }
  | { type: "launchFailed"; detail: string }
  | { type: "resume" };

/** Side effects the runtime must perform after a transition. */
export type MissionEffect =
  | { type: "startCrew"; brief: Brief }
  | { type: "runPreflight"; criteria: Criterion[] }
  | { type: "sendFeedback"; failures: CriterionResult[] }
  | { type: "openPullRequest"; brief: Brief; evidence: CriterionResult[] };

export type TransitionResult =
  | { ok: true; mission: Mission; effects: MissionEffect[] }
  | { ok: false; error: string };
