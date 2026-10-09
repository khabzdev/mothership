import { describe, expect, test } from "vite-plus/test";
import { DOOR_MODULE, DOOR_OPENING, bulkheads } from "../../src/features/world/bulkheads.ts";
import { AIRLOCK, DECK, LIFT } from "../../src/features/world/layout.ts";

const walls = bulkheads();
const north = walls.filter((m) => m.z === DECK.minZ && m.rotY === 0);
const east = walls.filter((m) => m.x === DECK.maxX);

describe("bulkheads", () => {
  test("each wall's modules cover it end to end without gaps or overlaps", () => {
    for (const side of [north, east]) {
      const along = (m: (typeof side)[number]) => (m.rotY === 0 ? m.x : m.z);
      const sorted = [...side].sort((a, b) => along(a) - along(b));
      const total = sorted.reduce((sum, m) => sum + m.width, 0);
      expect(total).toBeCloseTo(side === north ? DECK.maxX - DECK.minX : DECK.maxZ - DECK.minZ);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1]!;
        const m = sorted[i]!;
        expect(along(prev) + prev.width / 2).toBeCloseTo(along(m) - m.width / 2);
      }
    }
  });

  test("the lift and the airlock each sit in a door frame as wide as they are", () => {
    const lift = north.filter((m) => m.piece === "wall-door-wide");
    expect(lift).toEqual([expect.objectContaining({ x: LIFT.x, width: DOOR_MODULE })]);
    expect(DOOR_MODULE * DOOR_OPENING.width).toBeCloseTo(LIFT.width);

    const airlock = east.filter((m) => m.piece === "wall-door-wide");
    expect(airlock).toEqual([expect.objectContaining({ z: AIRLOCK.z })]);
    expect(DOOR_MODULE * DOOR_OPENING.width).toBeCloseTo(AIRLOCK.halfWidth * 2);
  });

  test("modules stay close to square (no stretched panels)", () => {
    for (const m of walls) expect(m.width).toBeGreaterThan(2.5);
    for (const m of walls) expect(m.width).toBeLessThan(3.3);
  });
});
