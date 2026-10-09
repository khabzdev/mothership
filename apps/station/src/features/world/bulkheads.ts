// The deck's bulkheads as Kenney Space Station Kit modules: each wall is a row of 1-unit pieces
// stretched to the wall's height, with door frames where the lift and the airlock are.
import { AIRLOCK, DECK, LIFT } from "./layout";

/** Bulkhead height (m): a module is 1 unit tall. */
export const WALL_H = 3.2;
/** A door module's width (m): its opening is 0.6 of it, 1.8 m, the lift's and airlock's width. */
export const DOOR_MODULE = 3;
/** The door frame's opening, as a share of the module's width and height. */
export const DOOR_OPENING = { width: 0.6, height: 0.695 } as const;

export type WallPiece = "wall" | "wall-door-wide" | "wall-window";

export interface Module {
  piece: WallPiece;
  /** Centre of the module on the floor. */
  x: number;
  z: number;
  /** Yaw: 0 runs along x (north and south walls), π/2 along z. */
  rotY: number;
  /** Width along the wall (m). */
  width: number;
}

/** Split a wall of `length` into `count` equal modules, with one door module centred on `door`. */
function row(
  from: number,
  length: number,
  count: number,
  door?: number,
): { at: number; width: number; door: boolean }[] {
  if (door === undefined) {
    const width = length / count;
    return Array.from({ length: count }, (_, i) => ({
      at: from + width * (i + 0.5),
      width,
      door: false,
    }));
  }
  // The door module, then the stretches either side split as evenly as the count allows.
  const before = door - DOOR_MODULE / 2 - from;
  const after = from + length - (door + DOOR_MODULE / 2);
  const rest = count - 1;
  const left = Math.max(0, Math.round((rest * before) / (before + after)));
  const right = rest - left;
  return [
    ...row(from, before, left),
    { at: door, width: DOOR_MODULE, door: true },
    ...row(door + DOOR_MODULE / 2, after, right),
  ];
}

/** Windows on every other module of a wall, starting from the second. */
const windowed = (i: number) => i % 2 === 1;

/** Every bulkhead module on the deck. */
export function bulkheads(): Module[] {
  const width = DECK.maxX - DECK.minX;
  const depth = DECK.maxZ - DECK.minZ;
  const modules: Module[] = [];
  // North: the boards, the library and the lift.
  for (const m of row(DECK.minX, width, 12, LIFT.x)) {
    modules.push({
      piece: m.door ? "wall-door-wide" : "wall",
      x: m.at,
      z: DECK.minZ,
      rotY: 0,
      width: m.width,
    });
  }
  // South: windows out to the stars.
  row(DECK.minX, width, 12).forEach((m, i) =>
    modules.push({
      piece: windowed(i) ? "wall-window" : "wall",
      x: m.at,
      z: DECK.maxZ,
      rotY: Math.PI,
      width: m.width,
    }),
  );
  // West: windows between the cabinets.
  row(DECK.minZ, depth, 9).forEach((m, i) =>
    modules.push({
      piece: windowed(i) ? "wall-window" : "wall",
      x: DECK.minX,
      z: m.at,
      rotY: Math.PI / 2,
      width: m.width,
    }),
  );
  // East: the airlock's inner door.
  for (const m of row(DECK.minZ, depth, 9, AIRLOCK.z)) {
    modules.push({
      piece: m.door ? "wall-door-wide" : "wall",
      x: DECK.maxX,
      z: m.at,
      rotY: -Math.PI / 2,
      width: m.width,
    });
  }
  return modules;
}
