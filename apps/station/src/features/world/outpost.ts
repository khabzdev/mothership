// The outpost around the island: KayKit base modules, a dome, a garage, wind turbines, solar
// panels, cargo and a truck on the island's outer ring, outside the walkable deck (the DECK clamp
// in moveWithCollisions keeps the Captain out, so none of it needs colliders).
import { GARAGE_SPOT, LAUNCH_PAD, SHIP_PAD } from "./layout";
import { MINING_TILES } from "./island";
import type { Placement } from "./placement";

/** Every outpost piece is drawn at this scale (a base module is then ≈4.5 m wide: the flat ring is 4 m deep beside the play area). */
export const OUTPOST_SCALE = 2;

/** Landing pads that later tasks draw: nothing of the outpost may stand within r of them. */
export const PAD_CLEARINGS: { x: number; z: number; r: number }[] = [
  { ...SHIP_PAD, r: 4 },
  { ...LAUNCH_PAD, r: 4 },
];

const at = (x: number, z: number, rotY = 0, y = 0, scale = OUTPOST_SCALE): Placement => ({
  position: [x, y, z],
  rotY,
  scale,
});

// Rows sit on the flat ring between the play area and the slope rim: north and south rows at
// z = ±16.1 (a module's depth just fits the 5.2 m band), the east column at x ≈ 20.3.
const NORTH_Z = -16.1;
const SOUTH_Z = 16.1;
const EAST_X = 20.3;
/** Tunnels are 2 m long natively: at this scale they bridge the 2 m gap between modules. */
const TUNNEL_SCALE = 1;
const TUNNEL_Y = 0.6;
const tunnel = (x: number, z: number) => at(x, z, 0, TUNNEL_Y, TUNNEL_SCALE);

/** North: a row of modules from the north-west corner, stopping short of the ship pad. */
const NORTH_ROW = [-20.1, -13.88, -7.8, -1.36];
const mining = {
  x: EAST_X - 0.1,
  z: MINING_TILES.reduce((sum, t) => sum + t.z, 0) / MINING_TILES.length,
};

/** The garage, beside the dome: drawn on its own (scene/Garage.tsx) since its door rolls up for crew sent home. */
export const GARAGE: Placement = at(GARAGE_SPOT.x, GARAGE_SPOT.z, Math.PI);

export const OUTPOST: Record<string, Placement[]> = {
  // North: modules joined by tunnels. South-west: the dome (the garage is GARAGE, facing the deck).
  basemodule_A: [at(NORTH_ROW[0], NORTH_Z)],
  basemodule_B: [at(NORTH_ROW[1], NORTH_Z)],
  basemodule_C: [at(NORTH_ROW[2], NORTH_Z)],
  basemodule_D: [at(NORTH_ROW[3], NORTH_Z)],
  basemodule_E: [at(-20.1, SOUTH_Z, Math.PI)],
  tunnel_straight_A: [
    tunnel(-16.96, NORTH_Z),
    tunnel(-10.8, NORTH_Z),
    tunnel(-4.8, NORTH_Z),
    tunnel(-17, SOUTH_Z),
  ],
  roofmodule_solarpanels: [at(NORTH_ROW[0], NORTH_Z, 0, 2), at(NORTH_ROW[2], NORTH_Z, 0, 2)],

  // East: the drill over the mining tiles and the wind turbines.
  drill_structure: [at(mining.x, mining.z)],
  windturbine_tall: [at(EAST_X, -6), at(EAST_X, -10)],
  windturbine_low: [at(EAST_X, 4.5)],

  // South: solar panels, then the cargo depot, containers and the truck with its trailer.
  solarpanel: [-10, -7.8, -5.6, -3.4].map((x) => at(x, SOUTH_Z)),
  cargodepot_A: [at(1.5, SOUTH_Z, Math.PI)],
  containers_A: [at(5.5, SOUTH_Z, Math.PI / 2)],
  containers_B: [at(7.2, SOUTH_Z)],
  cargo_A_stacked: [at(9.5, SOUTH_Z)],
  spacetruck: [at(13.3, SOUTH_Z, Math.PI / 2)],
  spacetruck_trailer: [at(15.5, SOUTH_Z, Math.PI / 2)],

  // Light posts just outside the walking clamp, at the play area's corners (the north-east one
  // moved south, out of the launch pad's clearing).
  lights: [at(-17.9, -12.8), at(-17.9, 12.8), at(17.9, 12.8), at(17.9, -8)],

  // Rocks scattered on the flat ring, in the gaps.
  rocks_A: [at(-20.4, -10, 0.6, 0, 1.2), at(20, 16.6, 2.1, 0, 1.2)],
  rocks_B: [at(-20.4, 4, 1.2, 0, 1.2), at(4.8, -16.2, 3, 0, 1.2)],
  rock_A: [at(-20.5, -4, 0.3, 0, 1.2), at(-20.5, 12, 2.4, 0, 1.2), at(20.6, 14.5, 0.9, 0, 1.2)],
  rock_B: [at(-20.5, 8, 2.8, 0, 1.2), at(-20.5, 0.5, 4.4, 0, 1.2)],
};
