import { describe, expect, test } from "vite-plus/test";
import {
  MISSION_STATES,
  createMission,
  transition,
  type Brief,
  type Mission,
  type MissionEvent,
  type MissionState,
} from "../src/index.ts";

const brief: Brief = {
  goal: "Add a dark mode toggle",
  criteria: [
    { id: "tests", kind: "command", command: "vp test" },
    { id: "looks-right", kind: "manual", label: "Toggle looks right" },
  ],
};

function step(mission: Mission, event: MissionEvent) {
  const result = transition(mission, event);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function inState(state: MissionState): Mission {
  const base = createMission(brief);
  switch (state) {
    case "briefing":
      return base;
    case "building":
      return step(base, { type: "launchCrew" }).mission;
    case "preflight":
      return step(inState("building"), { type: "crewStopped" }).mission;
    case "launching":
      return step(inState("preflight"), {
        type: "preflightFinished",
        results: [
          { criterionId: "tests", verdict: "go" },
          { criterionId: "looks-right", verdict: "go" },
        ],
      }).mission;
    case "launched":
      return step(inState("launching"), { type: "launchSucceeded", prUrl: "https://pr/1" }).mission;
    case "redAlert":
      return step(inState("building"), { type: "crewNeedsInput", detail: "Approve rm?" }).mission;
  }
}

describe("createMission", () => {
  test("starts in briefing with no attempts", () => {
    const mission = createMission(brief);
    expect(mission).toMatchObject({ state: "briefing", attempts: 0, maxAttempts: 3, brief });
  });
});

describe("happy path", () => {
  test("briefing → building starts the crew", () => {
    const result = step(createMission(brief), { type: "launchCrew" });
    expect(result.mission.state).toBe("building");
    expect(result.mission.attempts).toBe(1);
    expect(result.effects).toEqual([{ type: "startCrew", brief }]);
  });

  test("building → preflight runs the checks", () => {
    const result = step(inState("building"), { type: "crewStopped" });
    expect(result.mission.state).toBe("preflight");
    expect(result.effects).toEqual([{ type: "runPreflight", criteria: brief.criteria }]);
  });

  test("preflight all GO → launching opens a PR", () => {
    const result = step(inState("preflight"), {
      type: "preflightFinished",
      results: [
        { criterionId: "tests", verdict: "go" },
        { criterionId: "looks-right", verdict: "go" },
      ],
    });
    expect(result.mission.state).toBe("launching");
    expect(result.mission.lastPreflight).toHaveLength(2);
    expect(result.effects).toEqual([
      { type: "openPullRequest", brief, evidence: result.mission.lastPreflight },
    ]);
  });

  test("launching → launched records the PR url", () => {
    const result = step(inState("launching"), { type: "launchSucceeded", prUrl: "https://pr/1" });
    expect(result.mission.state).toBe("launched");
    expect(result.mission.prUrl).toBe("https://pr/1");
    expect(result.effects).toEqual([]);
  });
});

describe("NO-GO loop", () => {
  test("any NO-GO sends failures back to the crew and rebuilds", () => {
    const failing = { criterionId: "tests", verdict: "nogo", output: "1 failed" } as const;
    const result = step(inState("preflight"), {
      type: "preflightFinished",
      results: [failing, { criterionId: "looks-right", verdict: "go" }],
    });
    expect(result.mission.state).toBe("building");
    expect(result.mission.attempts).toBe(2);
    expect(result.effects).toEqual([{ type: "sendFeedback", failures: [failing] }]);
  });

  test("a result missing for a criterion counts as NO-GO", () => {
    const result = step(inState("preflight"), {
      type: "preflightFinished",
      results: [{ criterionId: "tests", verdict: "go" }],
    });
    expect(result.mission.state).toBe("building");
    expect(result.effects).toEqual([
      {
        type: "sendFeedback",
        failures: [{ criterionId: "looks-right", verdict: "nogo", output: "No result reported" }],
      },
    ]);
  });
});

describe("red alert", () => {
  test("crew needing input raises an alert and resumes to building", () => {
    const alerted = inState("redAlert");
    expect(alerted.alert).toEqual({ reason: "needsInput", detail: "Approve rm?" });
    expect(alerted.resumeTo).toBe("building");

    const result = step(alerted, { type: "resume" });
    expect(result.mission.state).toBe("building");
    expect(result.mission.alert).toBeUndefined();
    expect(result.mission.resumeTo).toBeUndefined();
  });

  test("crew crashing raises an alert", () => {
    const result = step(inState("building"), { type: "crewCrashed", detail: "exit 1" });
    expect(result.mission.state).toBe("redAlert");
    expect(result.mission.alert).toEqual({ reason: "crashed", detail: "exit 1" });
  });

  test("failed launch raises an alert and resumes to a retried launch", () => {
    const alerted = step(inState("launching"), { type: "launchFailed", detail: "gh not authed" });
    expect(alerted.mission.state).toBe("redAlert");
    expect(alerted.mission.alert).toEqual({ reason: "launchFailed", detail: "gh not authed" });

    const resumed = step(alerted.mission, { type: "resume" });
    expect(resumed.mission.state).toBe("launching");
    expect(resumed.effects).toEqual([
      { type: "openPullRequest", brief, evidence: alerted.mission.lastPreflight },
    ]);
  });
});

describe("briefing validation", () => {
  test("cannot launch a brief without a goal", () => {
    const result = transition(createMission({ ...brief, goal: "  " }), { type: "launchCrew" });
    expect(result).toEqual({ ok: false, error: "Brief needs a goal" });
  });

  test("cannot launch a brief without criteria", () => {
    const result = transition(createMission({ ...brief, criteria: [] }), { type: "launchCrew" });
    expect(result).toEqual({ ok: false, error: "Brief needs at least one acceptance criterion" });
  });
});

describe("transition table", () => {
  const events: MissionEvent[] = [
    { type: "launchCrew" },
    { type: "crewStopped" },
    { type: "crewNeedsInput", detail: "?" },
    { type: "crewCrashed", detail: "x" },
    { type: "preflightFinished", results: [] },
    { type: "launchSucceeded", prUrl: "u" },
    { type: "launchFailed", detail: "x" },
    { type: "resume" },
    { type: "refuel", extraAttempts: 1 },
  ];

  const allowed: Record<MissionState, MissionEvent["type"][]> = {
    briefing: ["launchCrew"],
    building: ["crewStopped", "crewNeedsInput", "crewCrashed"],
    preflight: ["preflightFinished"],
    launching: ["launchSucceeded", "launchFailed"],
    launched: [],
    redAlert: ["resume"],
  };

  for (const state of MISSION_STATES) {
    for (const event of events) {
      const ok = allowed[state].includes(event.type);
      test(`${state} + ${event.type} → ${ok ? "allowed" : "rejected"}`, () => {
        const result = transition(inState(state), event);
        expect(result.ok).toBe(ok);
        if (!result.ok) {
          expect(result.error.startsWith(`Cannot ${event.type} while ${state}`)).toBe(true);
        }
      });
    }
  }

  test("transitions never mutate the input mission", () => {
    const mission = inState("building");
    const snapshot = structuredClone(mission);
    transition(mission, { type: "crewStopped" });
    expect(mission).toEqual(snapshot);
  });
});
