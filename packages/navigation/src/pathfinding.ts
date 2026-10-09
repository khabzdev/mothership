import { isWalkable, tileAt, type DeckLayout, type Point } from "./layout.ts";

/** Cost of stepping onto a tile. Corridors are cheapest so crew stick to the spine and tunnels. */
const STEP_COST = { corridor: 1, ground: 3 } as const;

const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * A* over the deck's tile grid (4-directional). Returns the tiles from `from` to `to`
 * inclusive, or null when either end isn't walkable or no route exists.
 */
export function findPath(layout: DeckLayout, from: Point, to: Point): Point[] | null {
  if (!isWalkable(layout, from) || !isWalkable(layout, to)) return null;

  const key = (p: Point) => p.y * layout.width + p.x;
  const goal = key(to);
  const cost = new Map<number, number>([[key(from), 0]]);
  const cameFrom = new Map<number, Point>();
  const open = new Map<number, { point: Point; score: number }>([
    [key(from), { point: from, score: manhattan(from, to) }],
  ]);

  while (open.size > 0) {
    let currentKey = -1;
    let current: { point: Point; score: number } | undefined;
    for (const [k, node] of open) {
      if (!current || node.score < current.score) {
        currentKey = k;
        current = node;
      }
    }
    open.delete(currentKey);
    if (currentKey === goal) return rebuild(cameFrom, current!.point, key);

    const base = cost.get(currentKey)!;
    for (const d of DIRECTIONS) {
      const next = { x: current!.point.x + d.x, y: current!.point.y + d.y };
      if (!isWalkable(layout, next)) continue;
      const nextKey = key(next);
      const nextCost = base + stepCost(layout, next);
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, current!.point);
      open.set(nextKey, { point: next, score: nextCost + manhattan(next, to) });
    }
  }
  return null;
}

/** Total cost of walking a path (the start tile is free). */
export function pathCost(layout: DeckLayout, path: readonly Point[]): number {
  return path.slice(1).reduce((sum, p) => sum + stepCost(layout, p), 0);
}

function stepCost(layout: DeckLayout, point: Point): number {
  const tile = tileAt(layout, point);
  return tile === "corridor" || tile === "ground" ? STEP_COST[tile] : Infinity;
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function rebuild(cameFrom: Map<number, Point>, end: Point, key: (p: Point) => number): Point[] {
  const path = [end];
  let previous = cameFrom.get(key(end));
  while (previous) {
    path.unshift(previous);
    previous = cameFrom.get(key(previous));
  }
  return path;
}
