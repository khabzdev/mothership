import { describe, expect, test } from "vite-plus/test";
import { MIN_DWELL_MS, createDwell, propose, tick, type Waypoint } from "../src/index.ts";

const src: Waypoint = { kind: "module", moduleId: "src" };
const tests: Waypoint = { kind: "module", moduleId: "tests" };
const bay: Waypoint = { kind: "engineeringBay" };
const rail: Waypoint = { kind: "bridgeRail" };

describe("dwell", () => {
  test("crew start in quarters", () => {
    expect(createDwell(0).current).toEqual({ kind: "quarters" });
  });

  test("moves immediately once the minimum dwell has passed", () => {
    const result = propose(createDwell(0), src, MIN_DWELL_MS);
    expect(result.move).toEqual(src);
    expect(result.dwell).toEqual({ current: src, since: MIN_DWELL_MS });
  });

  test("proposing the current waypoint does nothing and clears any pending move", () => {
    let dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    dwell = propose(dwell, tests, MIN_DWELL_MS + 100).dwell;
    const result = propose(dwell, src, MIN_DWELL_MS + 200);
    expect(result.move).toBeUndefined();
    expect(result.dwell.pending).toBeUndefined();
  });

  test("a move proposed too early is held as pending", () => {
    const dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    const result = propose(dwell, tests, MIN_DWELL_MS + 500);
    expect(result.move).toBeUndefined();
    expect(result.dwell.pending).toEqual(tests);
  });

  test("rapid proposals keep only the latest pending move", () => {
    let dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    dwell = propose(dwell, tests, MIN_DWELL_MS + 100).dwell;
    dwell = propose(dwell, bay, MIN_DWELL_MS + 200).dwell;
    expect(dwell.pending).toEqual(bay);
  });

  test("tick releases the pending move once dwell has elapsed", () => {
    let dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    dwell = propose(dwell, tests, MIN_DWELL_MS + 100).dwell;

    expect(tick(dwell, MIN_DWELL_MS * 2 - 1).move).toBeUndefined();

    const released = tick(dwell, MIN_DWELL_MS * 2);
    expect(released.move).toEqual(tests);
    expect(released.dwell).toEqual({ current: tests, since: MIN_DWELL_MS * 2 });
  });

  test("tick without a pending move does nothing", () => {
    const dwell = createDwell(0);
    expect(tick(dwell, 10_000)).toEqual({ dwell });
  });

  test("red alert skips the dwell", () => {
    const dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    const result = propose(dwell, rail, MIN_DWELL_MS + 1);
    expect(result.move).toEqual(rail);
    expect(result.dwell.pending).toBeUndefined();
  });

  test("custom dwell durations are respected", () => {
    const result = propose(createDwell(0), src, 500, { minDwellMs: 500 });
    expect(result.move).toEqual(src);
  });

  test("never mutates its input", () => {
    const dwell = propose(createDwell(0), src, MIN_DWELL_MS).dwell;
    const snapshot = structuredClone(dwell);
    propose(dwell, tests, MIN_DWELL_MS + 1);
    tick(dwell, 99_999);
    expect(dwell).toEqual(snapshot);
  });
});
