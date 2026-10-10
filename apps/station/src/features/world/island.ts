// The deck as a terrain island floating in space: KayKit terrain tiles on a 4 m grid, a flat
// plateau under the play area and a ring of slopes around it falling away outward.
import { DECK } from "./layout";
import type { Placement } from "./placement";

export type TerrainPiece =
  | "terrain_tall"
  | "terrain_low"
  | "terrain_mining"
  | "terrain_slope"
  | "terrain_slope_inner_corner"
  | "terrain_slope_outer_corner";

/** A native tile is 2 × 2 units; scaled ×2 it is 4 m. */
export const TERRAIN_SCALE = 2;
export const TILE = 4;

/** Every tile spans y = -1 … top in its own frame (measured from the glTF position accessors). */
const NATIVE_TOP: Record<TerrainPiece, number> = {
  terrain_tall: 1,
  terrain_low: 0,
  terrain_mining: 1.07252836227417,
  terrain_slope: 1,
  terrain_slope_inner_corner: 1,
  terrain_slope_outer_corner: 1,
};

/** The deck grown by one tile on every side, in whole tiles and centred on the origin. */
const halfTiles = (half: number) => Math.ceil(half / (TILE / 2));
const reachX = (halfTiles(Math.max(-DECK.minX, DECK.maxX)) + 1) * (TILE / 2) + TILE / 2;
const reachZ = (halfTiles(Math.max(-DECK.minZ, DECK.maxZ)) + 1) * (TILE / 2) + TILE / 2;
export const ISLAND = { minX: -reachX, maxX: reachX, minZ: -reachZ, maxZ: reachZ };

/** The three east outer-ring tiles under the drill. */
export const MINING_TILES: { x: number; z: number }[] = [-TILE, 0, TILE].map((z) => ({
  x: ISLAND.maxX - TILE / 2,
  z,
}));

/** The world y of a tile's highest point. */
export function topOf(piece: TerrainPiece, placement: Placement): number {
  return placement.position[1] + NATIVE_TOP[piece] * placement.scale;
}

/** Tile centres along one axis. */
function centres(min: number, max: number): number[] {
  return Array.from({ length: Math.round((max - min) / TILE) }, (_, i) => min + TILE * (i + 0.5));
}

export function islandPlan(): Record<TerrainPiece, Placement[]> {
  const plan: Record<TerrainPiece, Placement[]> = {
    terrain_tall: [],
    terrain_low: [],
    terrain_mining: [],
    terrain_slope: [],
    terrain_slope_inner_corner: [],
    terrain_slope_outer_corner: [],
  };
  const place = (piece: TerrainPiece, x: number, z: number, rotY: number) =>
    plan[piece].push({
      position: [x, -NATIVE_TOP[piece] * TERRAIN_SCALE, z],
      rotY,
      scale: TERRAIN_SCALE,
    });
  const xs = centres(ISLAND.minX, ISLAND.maxX);
  const zs = centres(ISLAND.minZ, ISLAND.maxZ);
  const lastX = xs.length - 1;
  const lastZ = zs.length - 1;
  zs.forEach((z, k) => {
    xs.forEach((x, i) => {
      const west = i === 0;
      const east = i === lastX;
      const north = k === 0;
      const south = k === lastZ;
      if (!west && !east && !north && !south) return place("terrain_tall", x, z, 0);
      if (MINING_TILES.some((t) => t.x === x && t.z === z)) return place("terrain_mining", x, z, 0);
      // A slope falls toward its native -x, a corner toward native -x and +z; turn them outward.
      if ((west || east) && (north || south)) {
        const rotY = north ? (west ? -Math.PI / 2 : Math.PI) : west ? 0 : Math.PI / 2;
        return place("terrain_slope_outer_corner", x, z, rotY);
      }
      const rotY = west ? 0 : east ? Math.PI : north ? -Math.PI / 2 : Math.PI / 2;
      place("terrain_slope", x, z, rotY);
    });
  });
  return plan;
}
