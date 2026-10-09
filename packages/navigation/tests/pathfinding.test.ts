import { describe, expect, test } from "vite-plus/test";
import {
  findPath,
  isWalkable,
  layoutDeck,
  pathCost,
  pointFor,
  tileAt,
  type Point,
} from "../src/index.ts";

const layout = layoutDeck(["docs", "src", "tests"]);

function expectValidPath(path: Point[] | null, from: Point, to: Point) {
  expect(path).not.toBeNull();
  expect(path![0]).toEqual(from);
  expect(path!.at(-1)).toEqual(to);
  for (let i = 1; i < path!.length; i++) {
    const a = path![i - 1]!;
    const b = path![i]!;
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
    expect(isWalkable(layout, b)).toBe(true);
  }
}

describe("findPath", () => {
  test("a path to the start point is just the start", () => {
    const hub = layout.points.hub;
    expect(findPath(layout, hub, hub)).toEqual([hub]);
  });

  test("walks straight along the spine", () => {
    const { bridgeRail, hub } = layout.points;
    const path = findPath(layout, bridgeRail, hub);
    expectValidPath(path, bridgeRail, hub);
    expect(path).toHaveLength(hub.x - bridgeRail.x + 1);
  });

  test("quarters to airlock follows corridors only", () => {
    const from = pointFor(layout, { kind: "quarters" });
    const to = pointFor(layout, { kind: "airlock" });
    const path = findPath(layout, from, to);
    expectValidPath(path, from, to);
    expect(path!.every((p) => tileAt(layout, p) === "corridor")).toBe(true);
  });

  test("prefers a longer corridor route over a shortcut across open ground", () => {
    // Two doors above the spine: the straight line between them runs along row spineY-1 (ground).
    const from = pointFor(layout, { kind: "quarters" });
    const to = pointFor(layout, { kind: "module", moduleId: "docs" });
    const path = findPath(layout, from, to)!;
    expectValidPath(path, from, to);
    expect(path.every((p) => tileAt(layout, p) === "corridor")).toBe(true);
    expect(pathCost(layout, path)).toBe(path.length - 1);
  });

  test("uses open ground when it is the only way", () => {
    const from = { x: 1, y: 1 };
    const to = layout.points.bridgeRail;
    const path = findPath(layout, from, to);
    expectValidPath(path, from, to);
    expect(path!.some((p) => tileAt(layout, p) === "ground")).toBe(true);
  });

  test("returns null when the target is a room", () => {
    const room = layout.modules[0]!;
    expect(findPath(layout, layout.points.hub, { x: room.x + 1, y: room.y + 1 })).toBeNull();
  });

  test("returns null when the start is not walkable", () => {
    expect(findPath(layout, { x: 0, y: 0 }, layout.points.hub)).toBeNull();
  });

  test("returns null for out-of-bounds points", () => {
    expect(findPath(layout, layout.points.hub, { x: 999, y: 999 })).toBeNull();
  });

  test("is deterministic", () => {
    const from = { x: 1, y: 1 };
    const to = pointFor(layout, { kind: "airlock" });
    expect(findPath(layout, from, to)).toEqual(findPath(layout, from, to));
  });

  test("finds the cheapest path (matches brute-force Dijkstra cost)", () => {
    const big = layoutDeck(Array.from({ length: 9 }, (_, i) => `m${i}`));
    const walkable: Point[] = [];
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) if (isWalkable(big, { x, y })) walkable.push({ x, y });
    }
    const from = big.points.bridgeRail;
    const best = dijkstra(big, from);
    for (const to of walkable.filter((_, i) => i % 7 === 0)) {
      const path = findPath(big, from, to);
      expect(pathCost(big, path!)).toBe(best.get(`${to.x},${to.y}`));
    }
  });
});

function dijkstra(l: ReturnType<typeof layoutDeck>, from: Point): Map<string, number> {
  const dist = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const queue: [Point, number][] = [[from, 0]];
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1]);
    const [p, d] = queue.shift()!;
    if (d > (dist.get(`${p.x},${p.y}`) ?? Infinity)) continue;
    for (const n of [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ]) {
      if (!isWalkable(l, n)) continue;
      const nd = d + pathCost(l, [p, n]);
      if (nd < (dist.get(`${n.x},${n.y}`) ?? Infinity)) {
        dist.set(`${n.x},${n.y}`, nd);
        queue.push([n, nd]);
      }
    }
  }
  return dist;
}
