import { describe, expect, test } from "vite-plus/test";
import { GATE, departure, nextAtDoor, walkTime } from "../../src/features/world/departure.ts";
import { GARAGE_DOOR } from "../../src/features/world/layout.ts";

const path = [
  { x: GARAGE_DOOR.x, z: 4 },
  { x: GARAGE_DOOR.x, z: GARAGE_DOOR.z },
];
const walk = walkTime(path);
const at = (beat: keyof typeof GATE, k = 0.5) => {
  let t = walk;
  for (const b of Object.keys(GATE) as (keyof typeof GATE)[]) {
    if (b === beat) return departure(path, t + GATE[b] * k);
    t += GATE[b];
  }
  throw new Error(beat);
};

describe("departure through the garage", () => {
  test("walks the path with the door shut", () => {
    const f = departure(path, walk / 2);
    expect(f).toMatchObject({ walking: true, door: 0, inside: false, atDoor: false, says: null });
    expect(f.z).toBeGreaterThan(4);
    expect(f.z).toBeLessThan(GARAGE_DOOR.z);
  });

  test("at the door it pleads while the door rolls up", () => {
    const f = at("open");
    expect(f).toMatchObject({ walking: false, atDoor: true, says: "plea", inside: false });
    expect(f.door).toBeCloseTo(0.5);
    expect(f.x).toBeCloseTo(GARAGE_DOOR.x);
    expect(f.z).toBeCloseTo(GARAGE_DOOR.z);
  });

  test("it steps in under the open door and is inside", () => {
    const stepping = at("step");
    expect(stepping).toMatchObject({ door: 1, walking: true, inside: false });
    expect(stepping.z).toBeGreaterThan(GARAGE_DOOR.z);
    const inside = at("close", 0.01);
    expect(inside).toMatchObject({ inside: true, walking: false });
    expect(inside.z).toBeGreaterThanOrEqual(GARAGE_DOOR.z + 1.5);
  });

  test("the door rolls down on a cry, then it's done", () => {
    const closing = at("close");
    expect(closing).toMatchObject({ says: "cry", inside: true });
    expect(closing.door).toBeCloseTo(0.5);
    expect(at("close", 1).door).toBeCloseTo(0);
    expect(at("gone", 0.5).done).toBe(false);
    expect(at("gone", 1)).toMatchObject({ door: 0, done: true });
  });

  test("it all takes 3 s after the walk", () => {
    expect(Object.values(GATE).reduce((a, b) => a + b)).toBeCloseTo(3);
    expect(departure(path, walk + 2.99).done).toBe(false);
    expect(departure(path, walk + 3).done).toBe(true);
  });
});

describe("one at a time at the garage door", () => {
  test("the first in line goes when the door is free", () => {
    expect(nextAtDoor(["a", "b"], null)).toBe("a");
    expect(nextAtDoor([], null)).toBeNull();
  });

  test("the second waits while the first is busy", () => {
    expect(nextAtDoor(["b"], "a")).toBe("a");
  });
});
