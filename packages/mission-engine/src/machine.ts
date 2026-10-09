import type {
  Alert,
  Brief,
  CriterionResult,
  Mission,
  MissionEffect,
  MissionEvent,
  TransitionResult,
} from "./types.ts";

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface MissionOptions {
  maxAttempts?: number;
}

export function createMission(brief: Brief, options: MissionOptions = {}): Mission {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be ≥ 1");
  }
  return { state: "briefing", brief, attempts: 0, maxAttempts };
}

export function fuelRemaining(mission: Mission): number {
  return Math.max(0, mission.maxAttempts - mission.attempts);
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
    case "refuel":
      return refuel(mission, event.extraAttempts, reject);
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

  if (failures.length > 0 && fuelRemaining(mission) === 0) {
    const criteria = failures.length === 1 ? "criterion" : "criteria";
    return ok({
      ...next,
      state: "redAlert",
      alert: {
        reason: "outOfFuel",
        detail: `${failures.length} ${criteria} still NO-GO after ${mission.attempts} attempts`,
      },
      resumeTo: "building",
    });
  }
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
  if (mission.alert?.reason === "outOfFuel") {
    return { ok: false, error: "Out of fuel: refuel to continue" };
  }
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

function refuel(
  mission: Mission,
  extraAttempts: number,
  reject: TransitionResult,
): TransitionResult {
  if (mission.state !== "redAlert") return reject;
  if (mission.alert?.reason !== "outOfFuel") {
    return { ok: false, error: `Cannot refuel while redAlert (${mission.alert?.reason})` };
  }
  if (!Number.isInteger(extraAttempts) || extraAttempts < 1) {
    return { ok: false, error: "Refuel must add at least 1 attempt" };
  }
  const { alert: _alert, resumeTo: _resumeTo, ...rest } = mission;
  const failures = (mission.lastPreflight ?? []).filter((r) => r.verdict === "nogo");
  return ok(
    {
      ...rest,
      state: "building",
      maxAttempts: mission.maxAttempts + extraAttempts,
      attempts: mission.attempts + 1,
    },
    { type: "sendFeedback", failures },
  );
}
