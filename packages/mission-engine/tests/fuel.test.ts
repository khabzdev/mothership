import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_MAX_ATTEMPTS,
  createMission,
  fuelRemaining,
  transition,
  type Brief,
  type Mission,
  type MissionEvent,
} from "../src/index.ts";

const brief: Brief = {
  goal: "Fix flaky login test",
  criteria: [{ id: "tests", kind: "command", command: "vp test" }],
};

const nogo: MissionEvent = {
  type: "preflightFinished",
  results: [{ criterionId: "tests", verdict: "nogo", output: "1 failed" }],
};

function step(mission: Mission, event: MissionEvent) {
  const result = transition(mission, event);
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** Launch, then fail pre-flight `failures` times. */
function failPreflight(mission: Mission, failures: number) {
  let result = step(mission, { type: "launchCrew" });
  for (let i = 0; i < failures; i++) {
    result = step(step(result.mission, { type: "crewStopped" }).mission, nogo);
  }
  return result;
}

describe("fuel", () => {
  test("missions start with the default tank", () => {
    const mission = createMission(brief);
    expect(mission.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(fuelRemaining(mission)).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  test("tank size is configurable", () => {
    expect(createMission(brief, { maxAttempts: 5 }).maxAttempts).toBe(5);
  });

  test("tank size must be at least 1", () => {
    expect(() => createMission(brief, { maxAttempts: 0 })).toThrow("maxAttempts must be ≥ 1");
  });

  test("each build attempt burns one unit", () => {
    const mission = createMission(brief, { maxAttempts: 3 });
    expect(fuelRemaining(step(mission, { type: "launchCrew" }).mission)).toBe(2);
    expect(fuelRemaining(failPreflight(mission, 1).mission)).toBe(1);
  });

  test("NO-GO rebuilds while fuel remains", () => {
    const result = failPreflight(createMission(brief, { maxAttempts: 3 }), 2);
    expect(result.mission.state).toBe("building");
    expect(result.mission.attempts).toBe(3);
  });

  test("NO-GO on an empty tank raises an out-of-fuel alert instead of rebuilding", () => {
    const result = failPreflight(createMission(brief, { maxAttempts: 2 }), 2);
    expect(result.mission.state).toBe("redAlert");
    expect(result.mission.attempts).toBe(2);
    expect(result.mission.alert).toEqual({
      reason: "outOfFuel",
      detail: "1 criterion still NO-GO after 2 attempts",
    });
    expect(result.effects).toEqual([]);
    expect(fuelRemaining(result.mission)).toBe(0);
  });

  test("a single-attempt tank alerts on the first NO-GO", () => {
    const result = failPreflight(createMission(brief, { maxAttempts: 1 }), 1);
    expect(result.mission.state).toBe("redAlert");
  });

  test("an out-of-fuel mission cannot simply resume", () => {
    const empty = failPreflight(createMission(brief, { maxAttempts: 1 }), 1).mission;
    expect(transition(empty, { type: "resume" })).toEqual({
      ok: false,
      error: "Out of fuel: refuel to continue",
    });
  });

  test("refuelling adds attempts and rebuilds with the last failures", () => {
    const empty = failPreflight(createMission(brief, { maxAttempts: 1 }), 1).mission;
    const result = step(empty, { type: "refuel", extraAttempts: 2 });
    expect(result.mission.state).toBe("building");
    expect(result.mission.maxAttempts).toBe(3);
    expect(result.mission.attempts).toBe(2);
    expect(result.mission.alert).toBeUndefined();
    expect(result.effects).toEqual([
      {
        type: "sendFeedback",
        failures: [{ criterionId: "tests", verdict: "nogo", output: "1 failed" }],
      },
    ]);
  });

  test("refuel must add at least one attempt", () => {
    const empty = failPreflight(createMission(brief, { maxAttempts: 1 }), 1).mission;
    expect(transition(empty, { type: "refuel", extraAttempts: 0 })).toEqual({
      ok: false,
      error: "Refuel must add at least 1 attempt",
    });
  });

  test("refuel is only allowed on an out-of-fuel alert", () => {
    const building = step(createMission(brief), { type: "launchCrew" }).mission;
    const needsInput = step(building, { type: "crewNeedsInput", detail: "?" }).mission;
    expect(transition(building, { type: "refuel", extraAttempts: 1 }).ok).toBe(false);
    expect(transition(needsInput, { type: "refuel", extraAttempts: 1 })).toEqual({
      ok: false,
      error: "Cannot refuel while redAlert (needsInput)",
    });
  });

  test("an empty tank never launches", () => {
    const empty = failPreflight(createMission(brief, { maxAttempts: 1 }), 1).mission;
    const go: MissionEvent = {
      type: "preflightFinished",
      results: [{ criterionId: "tests", verdict: "go" }],
    };
    expect(transition(empty, go).ok).toBe(false);
  });
});
