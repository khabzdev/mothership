import type {
  Alert,
  Brief,
  CriterionResult,
  Mission,
  MissionEffect,
  MissionEvent,
  TransitionResult,
} from "./types.ts";

export function createMission(brief: Brief): Mission {
  return { state: "briefing", brief, attempts: 0 };
}

export function transition(mission: Mission, event: MissionEvent): TransitionResult {
  const reject: TransitionResult = {
    ok: false,
    error: `Cannot ${event.type} while ${mission.state}`,
  };
  switch (event.type) {
    case "launchCrew":
      return mission.state === "briefing" ? launchCrew(mission) : reject;
    case "crewStopped":
      return mission.state === "building"
        ? ok(
            { ...mission, state: "preflight" },
            { type: "runPreflight", criteria: mission.brief.criteria },
          )
        : reject;
    case "crewNeedsInput":
    case "crewCrashed":
      return mission.state === "building" ? raiseAlert(mission, event) : reject;
    case "launchFailed":
      return mission.state === "launching" ? raiseAlert(mission, event) : reject;
    case "preflightFinished":
      return mission.state === "preflight" ? finishPreflight(mission, event.results) : reject;
    case "launchSucceeded":
      return mission.state === "launching"
        ? ok({ ...mission, state: "launched", prUrl: event.prUrl })
        : reject;
    case "resume":
      return mission.state === "redAlert" ? resume(mission) : reject;
  }
}

function ok(mission: Mission, ...effects: MissionEffect[]): TransitionResult {
  return { ok: true, mission, effects };
}

function launchCrew(mission: Mission): TransitionResult {
  const { brief } = mission;
  if (!brief.goal.trim()) return { ok: false, error: "Brief needs a goal" };
  if (brief.criteria.length === 0) {
    return { ok: false, error: "Brief needs at least one acceptance criterion" };
  }
  return ok({ ...mission, state: "building", attempts: 1 }, { type: "startCrew", brief });
}

function finishPreflight(mission: Mission, reported: CriterionResult[]): TransitionResult {
  const results = mission.brief.criteria.map(
    (criterion): CriterionResult =>
      reported.find((r) => r.criterionId === criterion.id) ?? {
        criterionId: criterion.id,
        verdict: "nogo",
        output: "No result reported",
      },
  );
  const failures = results.filter((r) => r.verdict === "nogo");
  const next = { ...mission, lastPreflight: results };

  if (failures.length > 0) {
    return ok(
      { ...next, state: "building", attempts: mission.attempts + 1 },
      { type: "sendFeedback", failures },
    );
  }
  return ok(
    { ...next, state: "launching" },
    { type: "openPullRequest", brief: mission.brief, evidence: results },
  );
}

const ALERT_REASONS = {
  crewNeedsInput: "needsInput",
  crewCrashed: "crashed",
  launchFailed: "launchFailed",
} as const satisfies Record<AlertEvent["type"], Alert["reason"]>;

type AlertEvent = Extract<
  MissionEvent,
  { type: "crewNeedsInput" | "crewCrashed" | "launchFailed" }
>;

function raiseAlert(mission: Mission, event: AlertEvent): TransitionResult {
  return ok({
    ...mission,
    state: "redAlert",
    alert: { reason: ALERT_REASONS[event.type], detail: event.detail },
    resumeTo: mission.state,
  });
}

function resume(mission: Mission): TransitionResult {
  const { alert: _alert, resumeTo, ...rest } = mission;
  const state = resumeTo ?? "building";
  const resumed: Mission = { ...rest, state };
  if (state === "launching") {
    return ok(resumed, {
      type: "openPullRequest",
      brief: mission.brief,
      evidence: mission.lastPreflight ?? [],
    });
  }
  return ok(resumed);
}
