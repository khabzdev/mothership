import type { CrewInfo, InspectionInfo } from "@mothership/protocol";
import { describe, expect, test } from "vite-plus/test";
import {
  DOCK_Y,
  DRONE_SCALE,
  HOVER_Y,
  beatOffset,
  droneFlight,
  droneTarget,
  eyeColor,
  type Vec3,
} from "../../src/features/world/drone.ts";
import { CONSOLES } from "../../src/features/world/layout.ts";

const from: Vec3 = { x: -2, y: DOCK_Y, z: 12 };
const to: Vec3 = { x: 4, y: HOVER_Y, z: -3 };
const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe("drone size and height", () => {
  test("hovers above the name tags and is drawn larger", () => {
    expect(HOVER_Y).toBe(2.9);
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
    expect(Math.hypot(target!.x - c.x, target!.z - c.z)).toBeLessThan(0.5);
    // The screen faces the crew side (rotY); the drone faces back toward it.
    expect(Math.cos(target!.facing - (c.rotY + Math.PI))).toBeCloseTo(1);
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
