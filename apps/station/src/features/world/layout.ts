// The deck's floor plan: agent-office's office layout (src/shared/layout.ts) as a ship deck.
// Units are metres, +y up; consoles are agent-office's desks.
import { CONSOLE_COUNT } from "../crew/model";

export const DECK = { minX: -18, maxX: 18, minZ: -13, maxZ: 13 } as const;
export const CONSOLE_SIZE = { width: 2.2, depth: 1.1, height: 0.78 } as const;
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
        for (const dx of [-CONSOLE_SIZE.width / 2, CONSOLE_SIZE.width / 2]) {
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

/** Solid footprints the Captain can't walk through. */
export const COLLIDERS: Box[] = CONSOLES.map((c) => ({
  minX: c.x - CONSOLE_SIZE.width / 2,
  maxX: c.x + CONSOLE_SIZE.width / 2,
  minZ: c.z - CONSOLE_SIZE.depth / 2,
  maxZ: c.z + CONSOLE_SIZE.depth / 2,
}));

const RADIUS = 0.32;
const WALL_MARGIN = 0.6;

/** Move from (x,z) by (dx,dz), sliding along consoles and the deck walls. */
export function moveWithCollisions(
  x: number,
  z: number,
  dx: number,
  dz: number,
): { x: number; z: number } {
  const blocked = (px: number, pz: number) =>
    COLLIDERS.some(
      (b) =>
        px > b.minX - RADIUS &&
        px < b.maxX + RADIUS &&
        pz > b.minZ - RADIUS &&
        pz < b.maxZ + RADIUS,
    );
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
