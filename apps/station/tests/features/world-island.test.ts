import { describe, expect, test } from "vite-plus/test";
import { DECK } from "../../src/features/world/layout";
import {
  ISLAND,
  MINING_TILES,
  TERRAIN_SCALE,
  TILE,
  islandPlan,
  topOf,
  type TerrainPiece,
} from "../../src/features/world/island";

const entries = () =>
  Object.entries(islandPlan()).flatMap(([piece, at]) =>
    at.map((placement) => ({ piece: piece as TerrainPiece, placement })),
  );
const ground = () =>
  entries().filter((e) => e.piece === "terrain_tall" || e.piece === "terrain_mining");
const rim = () =>
  entries().filter((e) => e.piece === "terrain_slope" || e.piece === "terrain_slope_outer_corner");

describe("the island", () => {
  test("grows the deck by one tile on every side, in whole tiles", () => {
    expect(TILE).toBe(4);
    expect(TERRAIN_SCALE).toBe(2);
    expect(ISLAND.minX).toBeLessThanOrEqual(DECK.minX - TILE);
    expect(ISLAND.maxX).toBeGreaterThanOrEqual(DECK.maxX + TILE);
    expect(ISLAND.minZ).toBeLessThanOrEqual(DECK.minZ - TILE);
    expect(ISLAND.maxZ).toBeGreaterThanOrEqual(DECK.maxZ + TILE);
    expect((ISLAND.maxX - ISLAND.minX) % TILE).toBe(0);
    expect((ISLAND.maxZ - ISLAND.minZ) % TILE).toBe(0);
    expect(ISLAND.minX + ISLAND.maxX).toBe(0);
    expect(ISLAND.minZ + ISLAND.maxZ).toBe(0);
  });

  test("the island covers the play area with no gaps", () => {
    const tiles = ground().map((e) => e.placement.position);
    for (let x = DECK.minX; x <= DECK.maxX; x += 0.5) {
      for (let z = DECK.minZ; z <= DECK.maxZ; z += 0.5) {
        const covered = tiles.some(
          ([tx, , tz]) => Math.abs(x - tx) <= TILE / 2 && Math.abs(z - tz) <= TILE / 2,
        );
        expect(covered, `(${x}, ${z})`).toBe(true);
      }
    }
  });

  test("no two tiles overlap", () => {
    const all = entries().map((e) => e.placement.position);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const dx = Math.abs(all[i][0] - all[j][0]);
        const dz = Math.abs(all[i][2] - all[j][2]);
        expect(dx >= TILE || dz >= TILE, `${all[i].join(",")} vs ${all[j].join(",")}`).toBe(true);
      }
    }
  });

  test("the rim is slopes, with corner pieces at the corners, falling outward", () => {
    const corners = [
      [ISLAND.minX, ISLAND.minZ],
      [ISLAND.maxX, ISLAND.minZ],
      [ISLAND.minX, ISLAND.maxZ],
      [ISLAND.maxX, ISLAND.maxZ],
    ];
    const half = TILE / 2;
    const outer = (p: number, lo: number, hi: number) =>
      p - half === lo ? -1 : p + half === hi ? 1 : 0;
    const found = new Set<string>();
    for (const { piece, placement } of rim()) {
      const [x, , z] = placement.position;
      const ox = outer(x, ISLAND.minX, ISLAND.maxX);
      const oz = outer(z, ISLAND.minZ, ISLAND.maxZ);
      expect(ox !== 0 || oz !== 0, "on the outer ring").toBe(true);
      const isCorner = ox !== 0 && oz !== 0;
      expect(piece).toBe(isCorner ? "terrain_slope_outer_corner" : "terrain_slope");
      // A slope falls toward native -x; a corner toward native -x and +z.
      const c = Math.cos(placement.rotY);
      const s = Math.sin(placement.rotY);
      const dx = isCorner ? -c + s : -c;
      const dz = isCorner ? s + c : s;
      expect([Math.round(dx) + 0, Math.round(dz) + 0]).toEqual([ox, oz]);
      found.add(`${x},${z}`);
    }
    for (const [cx, cz] of corners) {
      expect(found.has(`${cx > 0 ? cx - half : cx + half},${cz > 0 ? cz - half : cz + half}`)).toBe(
        true,
      );
    }
    expect(rim().filter((e) => e.piece === "terrain_slope_outer_corner")).toHaveLength(4);
  });

  test("the whole grid is filled", () => {
    expect(entries()).toHaveLength(
      ((ISLAND.maxX - ISLAND.minX) / TILE) * ((ISLAND.maxZ - ISLAND.minZ) / TILE),
    );
    expect(entries()).toHaveLength(99);
  });

  test("ground and rim tops are at y = 0", () => {
    for (const { piece, placement } of entries()) {
      expect(topOf(piece, placement)).toBeCloseTo(0, 6);
    }
    for (const { placement } of entries().filter((e) => e.piece === "terrain_tall")) {
      expect(placement.position[1] + 1 * TERRAIN_SCALE).toBe(0);
    }
  });

  test("two mining tiles sit in the south-east outer ring", () => {
    expect(MINING_TILES).toEqual([
      { x: 20, z: 8 },
      { x: 20, z: 12 },
    ]);
    for (const t of MINING_TILES) expect(t.x).toBe(ISLAND.maxX - TILE / 2);
    const at = islandPlan().terrain_mining.map((p) => [p.position[0], p.position[2]]);
    expect(at).toEqual(MINING_TILES.map((t) => [t.x, t.z]));
  });
});
