import { describe, expect, test } from "vite-plus/test";
import { EJECT, departure, walkTime } from "../../src/features/world/departure.ts";
import { AIRLOCK } from "../../src/features/world/layout.ts";

const path = [
  { x: 10, z: 0 },
  { x: AIRLOCK.x - 0.7, z: 0 },
];
const walk = walkTime(path);
const at = (beat: keyof typeof EJECT, k = 0.5) => {
  let t = walk;
  for (const b of Object.keys(EJECT) as (keyof typeof EJECT)[]) {
    if (b === beat) return departure(path, t + EJECT[b] * k);
    t += EJECT[b];
  }
  throw new Error(beat);
};

describe("departure through the airlock", () => {
  test("walks the path with both doors shut", () => {
    const f = departure(path, walk / 2);
    expect(f).toMatchObject({ walking: true, inner: 0, outer: 0, atLock: false });
    expect(f.x).toBeGreaterThan(10);
    expect(f.x).toBeLessThan(AIRLOCK.x - 0.7);
  });

  test("the inner door opens, it steps in, and the door seals behind it", () => {
    expect(at("open").inner).toBeCloseTo(0.5);
    expect(at("step").x).toBeGreaterThan(AIRLOCK.x - 0.7);
    expect(at("seal", 1).inner).toBe(0);
  });

  test("it pleads under red lights before the outer hatch parts", () => {
    expect(at("wait")).toMatchObject({ red: true, says: "plea", outer: 0 });
    expect(at("part").outer).toBeCloseTo(0.5);
  });

  test("it's blown out tumbling, then the hatch shuts and it's done", () => {
    const blown = at("blow", 0.8);
    expect(blown).toMatchObject({ says: "cry", outer: 1 });
    expect(blown.x).toBeGreaterThan(AIRLOCK.x + 10);
    expect(blown.tumble).not.toBe(0);
    expect(at("shut", 1)).toMatchObject({ outer: 0, done: true, says: null });
  });
});
