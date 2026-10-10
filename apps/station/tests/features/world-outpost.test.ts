import { describe, expect, test } from "vite-plus/test";
import { DECK, DEPARTURE_PAD, LAUNCH_PAD, SHIP_PAD } from "../../src/features/world/layout";
import { ISLAND, TILE } from "../../src/features/world/island";
import { OUTPOST, OUTPOST_SCALE, PAD_CLEARINGS } from "../../src/features/world/outpost";
import { SPACE_PIECES } from "../../src/features/world/scene/models";

const placements = () =>
  Object.entries(OUTPOST).flatMap(([piece, at]) => at.map((placement) => ({ piece, placement })));
const WALL_MARGIN = 0.6;

describe("the outpost", () => {
  test("is drawn at 2.5x", () => {
    expect(OUTPOST_SCALE).toBe(2.5);
  });

  test("every outpost piece stands on the island, outside the play area", () => {
    for (const { piece, placement } of placements()) {
      const [x, , z] = placement.position;
      // On the flat ring: inside the island's slope rim (one tile in from the edge).
      expect(x, piece).toBeGreaterThan(ISLAND.minX + TILE);
      expect(x, piece).toBeLessThan(ISLAND.maxX - TILE);
      expect(z, piece).toBeGreaterThan(ISLAND.minZ + TILE);
      expect(z, piece).toBeLessThan(ISLAND.maxZ - TILE);
      if (piece === "lights") {
        // Just outside the walking clamp, within a metre of it.
        const out = Math.max(
          Math.abs(x) - (DECK.maxX - WALL_MARGIN),
          Math.abs(z) - (DECK.maxZ - WALL_MARGIN),
        );
        expect(out, piece).toBeGreaterThan(0);
        expect(out, piece).toBeLessThanOrEqual(1);
        continue;
      }
      const outside =
        x < DECK.minX - 0.6 || x > DECK.maxX + 0.6 || z < DECK.minZ - 0.6 || z > DECK.maxZ + 0.6;
      expect(outside, `${piece} at ${x}, ${z}`).toBe(true);
    }
  });

  test("outpost pieces keep the pad clearings free", () => {
    expect(PAD_CLEARINGS).toEqual([
      { ...SHIP_PAD, r: 4 },
      { ...LAUNCH_PAD, r: 4 },
      { ...DEPARTURE_PAD, r: 3 },
    ]);
    for (const { piece, placement } of placements())
      for (const c of PAD_CLEARINGS)
        expect(
          Math.hypot(placement.position[0] - c.x, placement.position[2] - c.z),
          `${piece} near ${c.x}, ${c.z}`,
        ).toBeGreaterThanOrEqual(c.r);
  });

  test("outpost pieces are known assets", () => {
    for (const piece of Object.keys(OUTPOST)) expect(SPACE_PIECES).toContain(piece);
  });
});
