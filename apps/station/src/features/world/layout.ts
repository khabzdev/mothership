// The deck's floor plan: agent-office's office layout (src/shared/layout.ts) as a ship deck.
// Units are metres, +y up; consoles are agent-office's desks.
import { CONSOLE_COUNT } from "../crew/model";

export const DECK = { minX: -18, maxX: 18, minZ: -13, maxZ: 13 } as const;
/** Spacing between neighbouring consoles (agent-office's desk width). */
export const CONSOLE_PITCH = 2.2;
/** The console's footprint: a KayKit desk slightly narrower than its slot. */
export const CONSOLE_SIZE = { width: 2.1, depth: 1.1, height: 0.7 } as const;
/** Landing pads outside the deck (centres): the ship's and the launch (north-east). */
export const SHIP_PAD = { x: 10.5, z: DECK.minZ - 2.5 } as const;
export const LAUNCH_PAD = { x: DECK.maxX + 1, z: DECK.minZ - 3 } as const;
export const SPAWN = { x: 8, z: 7 } as const;

export interface ConsoleDef {
  id: number;
  x: number;
  z: number;
  /** Which way the console's crew side faces (0 = +z). */
  rotY: number;
  label: string;
}

/** 16 consoles: 2 pods × 2 clusters × back-to-back rows × 2 (agent-office's buildDesks). */
function buildConsoles(): ConsoleDef[] {
  const consoles: ConsoleDef[] = [];
  const clusterX = [-10.5, -1.5];
  const pods = [
    { back: -4.55, front: -3.45 },
    { back: 3.45, front: 4.55 },
  ];
  for (const pod of pods) {
    for (const cx of clusterX) {
      for (const [z, rotY] of [
        [pod.back, Math.PI],
        [pod.front, 0],
      ] as const) {
        for (const dx of [-CONSOLE_PITCH / 2, CONSOLE_PITCH / 2]) {
          const id = consoles.length;
          consoles.push({ id, x: cx + dx, z, rotY, label: `Console ${id + 1}` });
        }
      }
    }
  }
  return consoles.slice(0, CONSOLE_COUNT);
}

export const CONSOLES: ConsoleDef[] = buildConsoles();

/** Where a console's crew member stands (or you stand to use it). */
export function consoleSeat(c: ConsoleDef, offset = 0.85): { x: number; z: number } {
  return { x: c.x + Math.sin(c.rotY) * offset, z: c.z + Math.cos(c.rotY) * offset };
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Flight Control: a desk against the south bulkhead, where a deck's pre-flight checks are set. */
export const FLIGHT_CONTROL = { x: -4.5, z: DECK.maxZ } as const;
/** The desk's footprint, its back to the bulkhead's inner face. */
export const FLIGHT_CONTROL_DESK = { width: 2.4, depth: 0.8, height: 0.9 } as const;
const BULKHEAD_FACE = DECK.maxZ - 0.15;

/** Standing in front of the Flight Control desk. */
export function flightControlInReach(x: number, z: number, reach = 1.6): boolean {
  return Math.hypot(x - FLIGHT_CONTROL.x, z - (FLIGHT_CONTROL.z - 1.4)) < reach;
}

/** Solid footprints the Captain can't walk through. */
export const COLLIDERS: Box[] = [
  ...CONSOLES.map((c) => ({
    minX: c.x - CONSOLE_SIZE.width / 2,
    maxX: c.x + CONSOLE_SIZE.width / 2,
    minZ: c.z - CONSOLE_SIZE.depth / 2,
    maxZ: c.z + CONSOLE_SIZE.depth / 2,
  })),
  {
    minX: FLIGHT_CONTROL.x - FLIGHT_CONTROL_DESK.width / 2,
    maxX: FLIGHT_CONTROL.x + FLIGHT_CONTROL_DESK.width / 2,
    minZ: BULKHEAD_FACE - FLIGHT_CONTROL_DESK.depth,
    maxZ: BULKHEAD_FACE,
  },
];

/** Furniture footprints, added as the pieces are placed (see useSolid). */
const placed = new Set<Box>();

/** Make a footprint solid until the returned function is called. */
export function addCollider(box: Box): () => void {
  placed.add(box);
  return () => void placed.delete(box);
}

const RADIUS = 0.32;
const WALL_MARGIN = 0.6;

/** Move from (x,z) by (dx,dz), sliding along consoles, furniture and the deck walls. */
export function moveWithCollisions(
  x: number,
  z: number,
  dx: number,
  dz: number,
): { x: number; z: number } {
  const hits = (b: Box, px: number, pz: number) =>
    px > b.minX - RADIUS && px < b.maxX + RADIUS && pz > b.minZ - RADIUS && pz < b.maxZ + RADIUS;
  const blocked = (px: number, pz: number) =>
    COLLIDERS.some((b) => hits(b, px, pz)) || [...placed].some((b) => hits(b, px, pz));
  const clampX = (v: number) =>
    Math.min(DECK.maxX - WALL_MARGIN, Math.max(DECK.minX + WALL_MARGIN, v));
  const clampZ = (v: number) =>
    Math.min(DECK.maxZ - WALL_MARGIN, Math.max(DECK.minZ + WALL_MARGIN, v));
  let nx = clampX(x + dx);
  if (blocked(nx, z)) nx = x;
  let nz = clampZ(z + dz);
  if (blocked(nx, nz)) nz = z;
  return { x: nx, z: nz };
}

/** The console you're standing at, if any (agent-office: within reach of its seat). */
export function consoleInReach(x: number, z: number, reach = 1.4): ConsoleDef | null {
  let best: ConsoleDef | null = null;
  let bestDistance = reach;
  for (const c of CONSOLES) {
    const seat = consoleSeat(c, 1.25);
    const d = Math.hypot(seat.x - x, seat.z - z);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

/** The garage's spot in the outpost's south row (outpost.ts places it there, facing the deck). */
export const GARAGE_SPOT = { x: -14, z: DECK.maxZ + 3.1 } as const;
/** Where crew sent home stand in front of the garage's door, at the play area's south edge. */
export const GARAGE_DOOR = { x: GARAGE_SPOT.x, z: DECK.maxZ - WALL_MARGIN } as const;

/** Clear lanes between and beside the console clusters, and the aisle down the middle (z = 0). */
const LANES_X = [-14.6, -6, 2.6];
/** The aisle between the south pod and Flight Control's desk. */
const SOUTH_AISLE_Z = 8.5;

/**
 * The way a crew member walks from its console to the garage: back out of its chair, along the
 * row to the nearest lane between clusters, down it to the south aisle, along that to the
 * garage's door and up to it.
 */
export function departurePath(c: ConsoleDef): { x: number; z: number }[] {
  const back = consoleSeat(c, 1.7);
  const lane = LANES_X.reduce((a, b) => (Math.abs(b - c.x) < Math.abs(a - c.x) ? b : a));
  return [
    consoleSeat(c, 0.85),
    back,
    { x: lane, z: back.z },
    { x: lane, z: SOUTH_AISLE_Z },
    { x: GARAGE_DOOR.x, z: SOUTH_AISLE_Z },
    { ...GARAGE_DOOR },
  ];
}

/** The console back to back with `c` (its pod partner across the desk), if any. */
export function partnerOf(c: ConsoleDef): ConsoleDef | undefined {
  return CONSOLES.find(
    (o) =>
      o.id !== c.id &&
      Math.abs(o.x - c.x) < 0.01 &&
      Math.abs(Math.abs(o.z - c.z) - CONSOLE_SIZE.depth) < 0.01,
  );
}

/** Where you stand to board your ship, and where you step out when it lands on a deck. */
export const SHIP_STOP = { x: SHIP_PAD.x, z: DECK.minZ + 1.5 } as const;

/** Standing in front of your ship's pad. */
export function shipInReach(x: number, z: number, reach = 1.5): boolean {
  return Math.hypot(x - SHIP_STOP.x, z - SHIP_STOP.z) < reach;
}

export type BoardId = "mission" | "launch" | "queue";

/** The boards, standing free on posts at the north edge of the island: issues (Mission board), pull requests (Launch board) and the task queue. */
export const BOARDS: Record<BoardId, { x: number; z: number; width: number; height: number }> = {
  mission: { x: -10.5, z: DECK.minZ + 0.6, width: 4.2, height: 2.3 },
  launch: { x: -4.5, z: DECK.minZ + 0.6, width: 4.2, height: 2.3 },
  queue: { x: 0.9, z: DECK.minZ + 0.6, width: 2.8, height: 2.3 },
};

/** Each board is solid: its base plate, posts and panel. */
for (const b of Object.values(BOARDS))
  COLLIDERS.push({
    minX: b.x - b.width / 2,
    maxX: b.x + b.width / 2,
    minZ: b.z - 0.1,
    maxZ: b.z + 0.5,
  });

/** The board you're standing in front of, if any. */
export function boardInReach(x: number, z: number): BoardId | null {
  for (const [id, b] of Object.entries(BOARDS) as [BoardId, (typeof BOARDS)[BoardId]][]) {
    if (Math.abs(x - b.x) < b.width / 2 && z - b.z < 2.6) return id;
  }
  return null;
}
