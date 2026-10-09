import { describe, expect, test } from "vite-plus/test";
import {
  MAX_MODULES,
  isWalkable,
  layoutDeck,
  pointFor,
  renderAscii,
  type DeckLayout,
  type Point,
} from "../src/index.ts";

function neighbours({ x, y }: Point): Point[] {
  return [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
}

/** Flood fill from the lift over walkable tiles. */
function reachable(layout: DeckLayout): Set<string> {
  const seen = new Set<string>();
  const queue = [layout.points.bridgeRail];
  while (queue.length) {
    const p = queue.pop()!;
    const key = `${p.x},${p.y}`;
    if (seen.has(key) || !isWalkable(layout, p)) continue;
    seen.add(key);
    queue.push(...neighbours(p));
  }
  return seen;
}

describe("layoutDeck", () => {
  test("renders a deck with three modules", () => {
    expect(renderAscii(layoutDeck(["tests", "src", "docs"]))).toMatchInlineSnapshot(`
      "###################
      #.QQQ.AAA.AAA.PPP.#
      #.QQQ.AAA.AAA.PPP.#
      #.QQQ.AAA.AAA.PPP.#
      #..=...=...=...=..#
      #L=======H=======.#
      #..=...=.......=..#
      #.EEE.AAA.....XXX.#
      #.EEE.AAA.....XXX.#
      #.EEE.AAA.....XXX.#
      ###################"
    `);
  });

  test("renders an empty deck with only facilities", () => {
    expect(renderAscii(layoutDeck([]))).toMatchInlineSnapshot(`
      "###########
      #.QQQ.PPP.#
      #.QQQ.PPP.#
      #.QQQ.PPP.#
      #..=...=..#
      #L===H===.#
      #..=...=..#
      #.EEE.XXX.#
      #.EEE.XXX.#
      #.EEE.XXX.#
      ###########"
    `);
  });

  test("modules are sorted and de-duplicated, so input order doesn't matter", () => {
    const a = layoutDeck(["src", "docs", "tests", "src"]);
    const b = layoutDeck(["tests", "docs", "src"]);
    expect(a).toEqual(b);
    expect(a.modules.map((m) => m.id)).toEqual(["docs", "src", "tests"]);
  });

  test("places modules alternately above and below the spine", () => {
    const { modules, spineY } = layoutDeck(["a", "b", "c"]);
    expect(modules.map((m) => m.y < spineY)).toEqual([true, false, true]);
  });

  test("caps the number of modules", () => {
    const names = Array.from(
      { length: MAX_MODULES + 5 },
      (_, i) => `dir${String(i).padStart(2, "0")}`,
    );
    const layout = layoutDeck(names);
    expect(layout.modules).toHaveLength(MAX_MODULES);
    expect(layout.modules.at(-1)?.id).toBe(`dir${String(MAX_MODULES - 1).padStart(2, "0")}`);
  });

  test("module variants are stable per name and within 0–4", () => {
    const first = layoutDeck(["api", "web"]).modules;
    const second = layoutDeck(["web", "api", "zzz"]).modules;
    for (const m of first) {
      expect(m.variant).toBeGreaterThanOrEqual(0);
      expect(m.variant).toBeLessThan(5);
      expect(second.find((n) => n.id === m.id)?.variant).toBe(m.variant);
    }
  });

  test("every door and point is walkable and reachable from the lift", () => {
    const layout = layoutDeck(["a", "b", "c", "d", "e"]);
    const seen = reachable(layout);
    const doors = [...layout.modules, ...Object.values(layout.facilities)].map((room) => room.door);
    for (const p of [...doors, ...Object.values(layout.points)]) {
      expect(seen.has(`${p.x},${p.y}`), `${p.x},${p.y}`).toBe(true);
    }
  });

  test("rooms are not walkable", () => {
    const layout = layoutDeck(["a"]);
    const room = layout.modules[0]!;
    expect(isWalkable(layout, { x: room.x + 1, y: room.y + 1 })).toBe(false);
  });

  test("out-of-bounds tiles are not walkable", () => {
    const layout = layoutDeck([]);
    expect(isWalkable(layout, { x: -1, y: 0 })).toBe(false);
    expect(isWalkable(layout, { x: layout.width, y: 0 })).toBe(false);
  });
});

describe("pointFor", () => {
  const layout = layoutDeck(["src", "tests"]);

  test("module waypoints resolve to the module's door", () => {
    const src = layout.modules.find((m) => m.id === "src")!;
    expect(pointFor(layout, { kind: "module", moduleId: "src" })).toEqual(src.door);
  });

  test("unknown modules fall back to the hub", () => {
    expect(pointFor(layout, { kind: "module", moduleId: "nope" })).toEqual(layout.points.hub);
  });

  test.each(["quarters", "engineeringBay", "preflightConsole", "airlock"] as const)(
    "%s resolves to its facility door",
    (kind) => {
      expect(pointFor(layout, { kind })).toEqual(layout.facilities[kind].door);
    },
  );

  test.each(["hub", "bridgeRail"] as const)("%s resolves to its spine point", (kind) => {
    expect(pointFor(layout, { kind })).toEqual(layout.points[kind]);
  });
});
