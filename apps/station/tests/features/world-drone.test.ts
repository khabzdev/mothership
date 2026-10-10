import type { CrewInfo, InspectionInfo } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import {
  DOCK_FACING,
  DOCK_Y,
  DRONE_SCALE,
  FLY_S,
  HOVER_Y,
  LINGER_S,
  VERDICT_S,
  beatOffset,
  droneFlight,
  droneStep,
  droneTarget,
  eyeColor,
  hearVerdict,
  restingDrone,
  type DroneState,
  type Vec3,
} from "../../src/features/world/drone.ts";
import { CONSOLES, INSPECTOR_DOCK } from "../../src/features/world/layout.ts";

const from: Vec3 = { x: -2, y: DOCK_Y, z: 12 };
const to: Vec3 = { x: 4, y: HOVER_Y, z: -3 };
const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe("drone size and height", () => {
  test("hovers above the name tags and is drawn larger", () => {
    expect(HOVER_Y).toBe(2.3);
    expect(DRONE_SCALE).toBe(1.4);
  });
});

describe("droneFlight", () => {
  test("starts at from and ends at to", () => {
    expect(droneFlight(from, to, 0, v())).toEqual(from);
    expect(droneFlight(from, to, 1, v())).toEqual(to);
  });

  test("t past 1 clamps to to, below 0 to from", () => {
    expect(droneFlight(from, to, 1.5, v())).toEqual(to);
    expect(droneFlight(from, to, -1, v())).toEqual(from);
  });

  test("arcs above both ends mid-flight, peaking 0.8 m over the higher", () => {
    const mid = droneFlight(from, to, 0.5, v());
    expect(mid.y).toBeGreaterThan(from.y);
    expect(mid.y).toBeGreaterThan(to.y);
    expect(mid.y).toBeCloseTo(HOVER_Y + 0.8);
  });

  test("eases on x and z", () => {
    const early = droneFlight(from, to, 0.1, v());
    // Smoothstep at 0.1 is 0.028: well short of a tenth of the way.
    expect(early.x - from.x).toBeLessThan((to.x - from.x) * 0.1);
  });

  test("writes into out and returns it", () => {
    const out = v();
    expect(droneFlight(from, to, 0.3, out)).toBe(out);
  });
});

const inspection = (over: Partial<InspectionInfo> = {}): InspectionInfo => ({
  state: "running",
  blockers: 0,
  notes: 0,
  ...over,
});

const member = (id: string, consoleId: number, info?: InspectionInfo): CrewInfo => ({
  id,
  kind: "agent",
  deckId: "d",
  consoleId,
  name: id,
  color: "#fff",
  character: "c",
  task: "",
  status: "idle",
  statusSince: 0,
  ...(info && { inspection: info }),
});

describe("droneTarget", () => {
  test("none running: null", () => {
    expect(droneTarget([], CONSOLES)).toBeNull();
    expect(
      droneTarget([member("a", 0, inspection({ state: "cleared" })), member("b", 1)], CONSOLES),
    ).toBeNull();
  });

  test("hovers over the running one's console, facing its screen", () => {
    const target = droneTarget(
      [member("a", 0, inspection({ state: "flagged" })), member("b", 5, inspection())],
      CONSOLES,
    );
    const c = CONSOLES[5]!;
    expect(target?.crewId).toBe("b");
    // Beyond the screen, on the side away from the crew member (the crew side is +rotY).
    expect(Math.hypot(target!.x - c.x, target!.z - c.z)).toBeCloseTo(0.7);
    expect(
      (target!.x - c.x) * Math.sin(c.rotY) + (target!.z - c.z) * Math.cos(c.rotY),
    ).toBeLessThan(0);
    // The screen faces the crew side (rotY); the drone faces the same way, at the screen and the crew.
    expect(Math.cos(target!.facing - c.rotY)).toBeCloseTo(1);
  });

  test("skips queued runs, and picks the lowest console of the rest", () => {
    const target = droneTarget(
      [
        member("q", 0, inspection({ queued: true })),
        member("late", 7, inspection()),
        member("early", 3, inspection()),
      ],
      CONSOLES,
    );
    expect(target?.crewId).toBe("early");
  });

  test("only queued: null", () => {
    expect(droneTarget([member("q", 0, inspection({ queued: true }))], CONSOLES)).toBeNull();
  });
});

describe("eyeColor", () => {
  test("one colour per beat", () => {
    expect(eyeColor("idle")).toBe("dim");
    expect(eyeColor("returning")).toBe("dim");
    expect(eyeColor("flying")).toBe("cyan");
    expect(eyeColor("scanning")).toBe("cyan");
    expect(eyeColor("cleared")).toBe("green");
    expect(eyeColor("flagged")).toBe("red");
    expect(eyeColor("failed")).toBe("amber");
  });
});

describe("beatOffset", () => {
  test("flagged shakes side to side within 0.25 m and ends centred", () => {
    let widest = 0;
    for (let t = 0; t <= 1.5; t += 0.01) {
      const o = beatOffset("flagged", t, v());
      widest = Math.max(widest, Math.abs(o.x));
      expect(o.y).toBe(0);
    }
    expect(widest).toBeGreaterThan(0.2);
    expect(widest).toBeLessThanOrEqual(0.25);
    expect(beatOffset("flagged", 1.5, v()).x).toBeCloseTo(0);
  });

  test("failed drops and comes back", () => {
    expect(beatOffset("failed", 0.75, v()).y).toBeLessThan(-0.2);
    expect(beatOffset("failed", 1.5, v()).y).toBeCloseTo(0);
  });

  test("idle bobs within 6 cm", () => {
    for (let t = 0; t < 4; t += 0.1)
      expect(Math.abs(beatOffset("idle", t, v()).y)).toBeLessThanOrEqual(0.06);
    expect(beatOffset("idle", 0.5, v()).y).toBeCloseTo(0.06);
  });

  test("writes into out", () => {
    const out = v();
    expect(beatOffset("scanning", 1, out)).toBe(out);
  });
});

describe("droneStep", () => {
  const spot = (crewId: string, x: number, z: number) => ({ crewId, x, z, facing: 0 });
  const nova = spot("nova", 4, -3);
  const vega = spot("vega", -6, 3);
  const near = (a: Vec3, b: Vec3) => {
    expect(a.x).toBeCloseTo(b.x);
    expect(a.y).toBeCloseTo(b.y);
    expect(a.z).toBeCloseTo(b.z);
  };

  /** A step just past (or, negated, just short of) a boundary, so no test rests on float rounding. */
  const EPS = 1e-6;

  /** Fly to `target` from the pad and settle over it, scanning; returns the clock. */
  function scanning(s: DroneState, target = nova): number {
    droneStep(s, 1, target);
    droneStep(s, 1 + FLY_S + EPS, target);
    return 1 + FLY_S + EPS;
  }

  test("rests at its pad, idle, facing the deck", () => {
    const s = restingDrone();
    droneStep(s, 0.5, null);
    expect(s.beat).toBe("idle");
    near(s.at, { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z });
    expect(s.facing).toBe(DOCK_FACING);
  });

  test("flies to a review, then scans over its console", () => {
    const s = restingDrone();
    droneStep(s, 1, nova);
    expect(s.beat).toBe("flying");
    expect(s.crewId).toBe("nova");
    droneStep(s, 1 + FLY_S / 2, nova);
    expect(s.beat).toBe("flying");
    expect(s.at.y).toBeGreaterThan(HOVER_Y);
    droneStep(s, 1 + FLY_S - EPS, nova);
    expect(s.beat).toBe("flying");
    droneStep(s, 1 + FLY_S + EPS, nova);
    expect(s.beat).toBe("scanning");
    near(s.at, { x: nova.x, y: HOVER_Y, z: nova.z });
  });

  test("a verdict arriving during the linger plays over the right console", () => {
    const s = restingDrone();
    const t = scanning(s);
    // The review leaves the roster a moment before its verdict arrives.
    droneStep(s, t + 0.1, null);
    droneStep(s, t + 0.2, null);
    expect(s.beat).toBe("scanning");
    expect(hearVerdict(s, "nova", "flagged")).toBe(true);
    droneStep(s, t + 0.3, null);
    expect(s.beat).toBe("flagged");
    near(s.at, { x: nova.x, y: HOVER_Y, z: nova.z });
  });

  test("with no verdict it heads home after the linger", () => {
    const s = restingDrone();
    const t = scanning(s);
    droneStep(s, t + 0.1, null);
    droneStep(s, t + 0.1 + LINGER_S - EPS, null);
    expect(s.beat).toBe("scanning");
    droneStep(s, t + 0.1 + LINGER_S + EPS, null);
    expect(s.beat).toBe("returning");
    expect(s.crewId).toBeNull();
  });

  test("a verdict for another crew member is ignored unless it's resting", () => {
    const s = restingDrone();
    const t = scanning(s);
    expect(hearVerdict(s, "vega", "cleared")).toBe(false);
    droneStep(s, t + 0.1, nova);
    expect(s.beat).toBe("scanning");

    const resting = restingDrone();
    expect(hearVerdict(resting, "vega", "cleared")).toBe(true);
    droneStep(resting, 1, null);
    expect(resting.beat).toBe("cleared");
    near(resting.at, { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z });
  });

  test("a verdict played at the pad ends idle in place, with no hop", () => {
    const s = restingDrone();
    hearVerdict(s, "vega", "flagged");
    droneStep(s, 1, null);
    expect(s.beat).toBe("flagged");
    droneStep(s, 1 + VERDICT_S - EPS, null);
    expect(s.beat).toBe("flagged");
    const done = 1 + VERDICT_S + EPS;
    droneStep(s, done, null);
    expect(s.beat).toBe("idle");
    expect(s.since).toBe(done);
    near(s.at, { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z });
    // Mid-way through what would have been a flight home, it's still on the pad: no arc.
    droneStep(s, done + FLY_S / 2, null);
    expect(s.beat).toBe("idle");
    expect(s.at.y).toBeCloseTo(DOCK_Y);
    expect(Math.cos(s.facing - DOCK_FACING)).toBeCloseTo(1);
  });

  test("moves on after VERDICT_S: to the next review, or home", () => {
    const s = restingDrone();
    const t = scanning(s);
    hearVerdict(s, "nova", "cleared");
    droneStep(s, t, null);
    droneStep(s, t + VERDICT_S - EPS, vega);
    expect(s.beat).toBe("cleared");
    droneStep(s, t + VERDICT_S + EPS, vega);
    expect(s.beat).toBe("flying");
    expect(s.crewId).toBe("vega");

    const home = restingDrone();
    const u = scanning(home);
    hearVerdict(home, "nova", "failed");
    droneStep(home, u, null);
    droneStep(home, u + VERDICT_S + EPS, null);
    expect(home.beat).toBe("returning");
  });

  test("returns to the pad and goes idle, facing the deck", () => {
    const s = restingDrone();
    const t = scanning(s);
    hearVerdict(s, "nova", "cleared");
    droneStep(s, t, null);
    const left = t + VERDICT_S + EPS;
    droneStep(s, left, null);
    expect(s.beat).toBe("returning");
    droneStep(s, left + FLY_S - EPS, null);
    expect(s.beat).toBe("returning");
    droneStep(s, left + FLY_S + EPS, null);
    expect(s.beat).toBe("idle");
    near(s.at, { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z });
    expect(Math.cos(s.facing - DOCK_FACING)).toBeCloseTo(1);
  });

  test("goes idle from the moment it lands, so the bob starts level", () => {
    const s = restingDrone();
    const t = scanning(s);
    hearVerdict(s, "nova", "cleared");
    droneStep(s, t, null);
    const left = t + VERDICT_S + EPS;
    droneStep(s, left, null);
    const landed = left + FLY_S + 0.37;
    droneStep(s, landed, null);
    expect(s.beat).toBe("idle");
    expect(s.since).toBe(landed);
    expect(beatOffset(s.beat, landed - s.since, v()).y).toBe(0);
  });

  test("a new review takes it off a scan of one that's gone", () => {
    const s = restingDrone();
    const t = scanning(s);
    droneStep(s, t + 0.1, vega);
    expect(s.beat).toBe("flying");
    expect(s.crewId).toBe("vega");
    // From where it was, over Nova's console.
    near(s.from, { x: nova.x, y: HOVER_Y, z: nova.z });
  });

  test("steps in place: the state it's given, and nothing new", () => {
    const s = restingDrone();
    const { at, from, to } = s;
    droneStep(s, 1, nova);
    droneStep(s, 1 + FLY_S + EPS, null);
    expect(s.at).toBe(at);
    expect(s.from).toBe(from);
    expect(s.to).toBe(to);
  });
});
