// The outpost around the island: KayKit base modules, a dome, a garage, wind turbines, solar
// panels, cargo and a truck on the island's outer ring, outside the walkable deck (the DECK clamp
// in moveWithCollisions keeps the Captain out, so none of it needs colliders).
import { DEPARTURE_PAD, LAUNCH_PAD, SHIP_PAD } from "./layout";
import { MINING_TILES } from "./island";
import type { Placement } from "./placement";

/** Every outpost piece is drawn at this scale (a base module is then ≈5.5 m wide). */
export const OUTPOST_SCALE = 2.5;

/** Landing pads that later tasks draw: nothing of the outpost may stand within r of them. */
export const PAD_CLEARINGS: { x: number; z: number; r: number }[] = [
  { ...SHIP_PAD, r: 4 },
  { ...LAUNCH_PAD, r: 4 },
  { ...DEPARTURE_PAD, r: 3 },
];

const at = (x: number, z: number, rotY = 0, y = 0, scale = OUTPOST_SCALE): Placement => ({
  position: [x, y, z],
  rotY,
  scale,
});

const NORTH_Z = -15.5;
const SOUTH_Z = 15.5;
const WEST_X = -20;
const EAST_X = 20;
/** Tunnels are 2 m long natively: shrunk so a gap between modules is spanned, raised to door height. */
const TUNNEL_SCALE = 1.25;
const TUNNEL_Y = 0.9;
const tunnel = (x: number, z: number, rotY: number) => at(x, z, rotY, TUNNEL_Y, TUNNEL_SCALE);

/** North: a row of modules from the north-west corner, stopping short of the ship pad. */
const NORTH_ROW = [-18, -10, -2, 6];
const mining = {
  x: MINING_TILES.reduce((sum, t) => sum + t.x, 0) / MINING_TILES.length,
  z: MINING_TILES.reduce((sum, t) => sum + t.z, 0) / MINING_TILES.length,
};

export const OUTPOST: Record<string, Placement[]> = {
  // North (and north-west): modules joined by tunnels, a dome and a garage down the west side.
  basemodule_A: [at(NORTH_ROW[0], NORTH_Z)],
  basemodule_B: [at(NORTH_ROW[1], NORTH_Z)],
  basemodule_C: [at(NORTH_ROW[2], NORTH_Z)],
  basemodule_D: [at(NORTH_ROW[3], NORTH_Z)],
  basemodule_E: [at(WEST_X, -8, Math.PI / 2)],
  basemodule_garage: [at(WEST_X, 0, Math.PI / 2)],
  tunnel_straight_A: [
    tunnel(-14, NORTH_Z, 0),
    tunnel(-6, NORTH_Z, 0),
    tunnel(2, NORTH_Z, 0),
    tunnel(WEST_X, -4, Math.PI / 2),
  ],
  roofmodule_solarpanels: [at(NORTH_ROW[0], NORTH_Z, 0, 2.5), at(NORTH_ROW[2], NORTH_Z, 0, 2.5)],

  // East: the drill over the mining tiles and the wind turbines, the middle left for the departure pad.
  drill_structure: [at(mining.x, mining.z)],
  windturbine_tall: [at(EAST_X, -6), at(EAST_X, -11)],
  windturbine_low: [at(EAST_X, 4.5)],

  // South: solar panels, then the cargo depot, containers and the truck with its trailer.
  solarpanel: [-18, -15.2, -12.4, -9.6].map((x) => at(x, SOUTH_Z)),
  cargodepot_A: [at(-2, SOUTH_Z)],
  containers_A: [at(3.5, 15, Math.PI / 2)],
  containers_B: [at(5.5, 16.5)],
  cargo_A_stacked: [at(8.5, SOUTH_Z)],
  spacetruck: [at(13.5, 16, Math.PI / 2)],
  spacetruck_trailer: [at(16.2, 16, Math.PI / 2)],

  // Light posts just outside the walking clamp, at the play area's corners (the north-east one
  // moved south, out of the launch pad's clearing).
  lights: [at(-18.2, -13.2), at(-18.2, 13.2), at(18.2, 13.2), at(18.2, -9.5)],

  // Rocks scattered on the outer ring.
  rocks_A: [at(-21, 12, 0.6), at(21, -8.5, 2.1), at(0, 17, 4)],
  rocks_B: [at(-21, -12, 1.2), at(-7, 17.2, 3), at(14.5, 17.4, 5)],
  rock_A: [at(-21, 6, 0.3), at(21, 5, 1.7), at(-4, -17.4, 2.4), at(21, 15.5, 0.9)],
  rock_B: [at(-21, 15, 2.8), at(21, -3.5, 4.4), at(16.5, 14.5, 1.1)],
};
