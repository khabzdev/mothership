import { ISLAND, TILE } from "../../src/features/world/island.ts";
import { PAD_CLEARINGS } from "../../src/features/world/outpost.ts";
import { describe, expect, test } from "vite-plus/test";
import {
  CONSOLES,
  DECK,
  SPAWN,
  GARAGE_DOOR,
  COLLIDERS,
  addCollider,
  BOARDS,
  BOARD_STAND_Z,
  SHIP_STOP,
  FLIGHT_CONTROL,
  INSPECTOR_DOCK,
  INSPECTOR_PAD,
  flightControlInReach,
  boardInReach,
  departurePath,
  shipInReach,
  partnerOf,
  consoleInReach,
  consoleSeat,
  moveWithCollisions,
  SHIP_PAD,
  LAUNCH_PAD,
} from "../../src/features/world/layout.ts";

describe("deck layout", () => {
  test("16 consoles in agent-office's desk positions", () => {
    expect(CONSOLES).toHaveLength(16);
    expect(CONSOLES[0]).toEqual({ id: 0, x: -11.6, z: -4.55, rotY: Math.PI, label: "Console 1" });
    expect(new Set(CONSOLES.map((c) => `${c.x},${c.z}`)).size).toBe(16);
  });

  test("you reach a console from its seat side", () => {
    const c = CONSOLES[5]!;
    const seat = consoleSeat(c, 1.25);
    expect(consoleInReach(seat.x, seat.z)?.id).toBe(5);
    expect(consoleInReach(SPAWN.x, SPAWN.z)).toBeNull();
  });

  test("consoles and walls block movement", () => {
    const c = CONSOLES[0]!;
    const start = consoleSeat(c, 1.5);
    const towardConsole = moveWithCollisions(start.x, start.z, 0, (c.z - start.z) * 2);
    expect(Math.abs(towardConsole.z - start.z)).toBeLessThan(1);
    expect(moveWithCollisions(17, 0, 10, 0).x).toBeLessThan(18);
  });

  test("placed furniture blocks movement until it's removed", () => {
    const remove = addCollider({ minX: 9, maxX: 10, minZ: 9, maxZ: 10 });
    expect(moveWithCollisions(8, 9.5, 1, 0).x).toBe(8);
    remove();
    expect(moveWithCollisions(8, 9.5, 1, 0).x).toBe(9);
  });

  test("every crew member's way to the garage door stays clear of the consoles", () => {
    for (const c of CONSOLES) {
      const path = departurePath(c);
      expect(path[0]).toEqual(consoleSeat(c));
      expect(path.at(-1)).toEqual(GARAGE_DOOR);
      // Skip the first leg: that's getting up out of its own chair.
      for (let i = 1; i < path.length - 1; i++) {
        const [a, b] = [path[i]!, path[i + 1]!];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
        for (let s = 0; s <= steps; s++) {
          const x = a.x + ((b.x - a.x) * s) / steps;
          const z = a.z + ((b.z - a.z) * s) / steps;
          const inside = COLLIDERS.some(
            (box) => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ,
          );
          expect(inside, `console ${c.id} leg ${i} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  test("the garage door is a spot in the play area", () => {
    expect(moveWithCollisions(GARAGE_DOOR.x, GARAGE_DOOR.z, 0, 0)).toEqual(GARAGE_DOOR);
    expect(consoleInReach(GARAGE_DOOR.x, GARAGE_DOOR.z)).toBeNull();
  });

  test("every console has one partner back to back across the desk", () => {
    for (const c of CONSOLES) {
      const p = partnerOf(c)!;
      expect(partnerOf(p)?.id).toBe(c.id);
      expect(p.rotY).not.toBe(c.rotY);
    }
  });

  test("you board your ship from in front of its pad, clear of any console", () => {
    expect(shipInReach(SHIP_STOP.x, SHIP_STOP.z)).toBe(true);
    expect(shipInReach(SPAWN.x, SPAWN.z)).toBe(false);
    expect(consoleInReach(SHIP_STOP.x, SHIP_STOP.z)).toBeNull();
    expect(moveWithCollisions(SHIP_STOP.x, SHIP_STOP.z, 0, 0)).toEqual(SHIP_STOP);
  });

  const boards = Object.entries(BOARDS) as [keyof typeof BOARDS, (typeof BOARDS)["mission"]][];
  /** The north walk limit: as close to the boards as the captain gets. */
  const NORTH_LIMIT = DECK.minZ + 0.6;

  test("boards stand on the flat ring just outside the play area, on the island", () => {
    for (const [, b] of boards) {
      // The plinth's front edge (b.z + 0.5) stays off the deck; the tilted top stays on the ring.
      expect(b.z + 0.5).toBeLessThanOrEqual(DECK.minZ);
      expect(b.z - 1).toBeGreaterThanOrEqual(ISLAND.minZ + TILE);
      expect(b.z).toBeCloseTo(DECK.minZ - 1.5);
    }
  });

  test("the boards are one wall along the north edge, big enough to read", () => {
    const sorted = boards.map(([, b]) => b).sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      const [a, b] = [sorted[i - 1]!, sorted[i]!];
      expect(a.x + a.width / 2).toBeLessThanOrEqual(b.x - b.width / 2);
      expect(a.z).toBe(b.z);
    }
    const west = sorted[0]!.x - sorted[0]!.width / 2;
    const east = sorted.at(-1)!.x + sorted.at(-1)!.width / 2;
    expect(east - west).toBeGreaterThanOrEqual(19);
    for (const b of sorted) expect(b.height).toBeGreaterThanOrEqual(4);
  });

  test("the board wall stays well clear of the ship pad's clearing", () => {
    const clearing = PAD_CLEARINGS.find((c) => c.x === SHIP_PAD.x && c.z === SHIP_PAD.z)!;
    for (const [, b] of boards)
      expect(b.x + b.width / 2).toBeLessThanOrEqual(clearing.x - clearing.r - 2);
  });

  test("walking north toward a board stops at the walk limit, in reach of it", () => {
    for (const [id, b] of boards)
      for (const dx of [-b.width / 2 + 0.3, 0, b.width / 2 - 0.3]) {
        let p = { x: b.x + dx, z: b.z + 4 };
        for (let i = 0; i < 60; i++) p = moveWithCollisions(p.x, p.z, 0, -0.1);
        expect(p.z, `${id} at ${dx}`).toBeCloseTo(NORTH_LIMIT);
        expect(boardInReach(p.x, p.z), `${id} at ${dx}`).toBe(id);
      }
  });

  test("you read a board standing in front of it, not from the consoles", () => {
    for (const [id, b] of boards) {
      expect(boardInReach(b.x, NORTH_LIMIT)).toBe(id);
      expect(boardInReach(b.x, BOARD_STAND_Z)).toBe(id);
      expect(moveWithCollisions(b.x, BOARD_STAND_Z, 0, 0)).toEqual({ x: b.x, z: BOARD_STAND_Z });
    }
    for (const c of CONSOLES) {
      const seat = consoleSeat(c, 1.25);
      expect(boardInReach(seat.x, seat.z)).toBeNull();
    }
  });

  test("you use Flight Control from in front of its desk, and can't walk into the desk", () => {
    const stand = { x: FLIGHT_CONTROL.x, z: FLIGHT_CONTROL.z - 1.4 };
    expect(flightControlInReach(stand.x, stand.z)).toBe(true);
    expect(flightControlInReach(SPAWN.x, SPAWN.z)).toBe(false);
    expect(consoleInReach(stand.x, stand.z)).toBeNull();
    expect(moveWithCollisions(stand.x, stand.z, 0, 0)).toEqual(stand);
    const pushed = moveWithCollisions(stand.x, stand.z, 0, 1);
    expect(pushed.z).toBe(stand.z);
  });

  test("the two pads stand apart on the island, outside the play area", () => {
    const pads = [SHIP_PAD, LAUNCH_PAD];
    for (const p of pads) {
      expect(p.x).toBeGreaterThan(ISLAND.minX);
      expect(p.x).toBeLessThan(ISLAND.maxX);
      expect(p.z).toBeGreaterThan(ISLAND.minZ);
      expect(p.z).toBeLessThan(ISLAND.maxZ);
      const inDeck = p.x >= DECK.minX && p.x <= DECK.maxX && p.z >= DECK.minZ && p.z <= DECK.maxZ;
      expect(inDeck).toBe(false);
      expect(PAD_CLEARINGS.some((c) => c.x === p.x && c.z === p.z)).toBe(true);
    }
    expect(Math.hypot(SHIP_PAD.x - LAUNCH_PAD.x, SHIP_PAD.z - LAUNCH_PAD.z)).toBeGreaterThanOrEqual(
      6,
    );
  });
});

describe("Inspector dock", () => {
  const overlaps = (a: (typeof COLLIDERS)[number], b: (typeof COLLIDERS)[number]) =>
    a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
  const pad = COLLIDERS.find(
    (b) =>
      b.minX < INSPECTOR_DOCK.x &&
      INSPECTOR_DOCK.x < b.maxX &&
      b.minZ < INSPECTOR_DOCK.z &&
      INSPECTOR_DOCK.z < b.maxZ,
  );

  test("just east of Flight Control, on the deck", () => {
    expect(INSPECTOR_DOCK).toEqual({ x: FLIGHT_CONTROL.x + 2.4, z: FLIGHT_CONTROL.z - 0.6 });
    expect(INSPECTOR_DOCK.x).toBeGreaterThan(DECK.minX);
    expect(INSPECTOR_DOCK.x).toBeLessThan(DECK.maxX);
    expect(INSPECTOR_DOCK.z).toBeGreaterThan(DECK.minZ);
    expect(INSPECTOR_DOCK.z).toBeLessThan(DECK.maxZ);
  });

  test("its pad is solid, and overlaps no other collider", () => {
    expect(pad).toEqual({
      minX: INSPECTOR_DOCK.x - INSPECTOR_PAD,
      maxX: INSPECTOR_DOCK.x + INSPECTOR_PAD,
      minZ: INSPECTOR_DOCK.z - INSPECTOR_PAD,
      maxZ: INSPECTOR_DOCK.z + INSPECTOR_PAD,
    });
    expect(COLLIDERS.filter((b) => b !== pad && overlaps(b, pad!))).toEqual([]);
    // Walking at the pad from the west stops short of it.
    const start = { x: INSPECTOR_DOCK.x - 1.2, z: INSPECTOR_DOCK.z };
    expect(moveWithCollisions(start.x, start.z, 0, 0)).toEqual(start);
    expect(moveWithCollisions(start.x, start.z, 0.6, 0).x).toBe(start.x);
  });

  test("the spawn, every console, Flight Control and the garage door are still reachable", () => {
    // Flood the deck from the spawn in 0.25 m steps, walking as the Captain does.
    const STEP = 0.25;
    const key = (x: number, z: number) => `${Math.round(x / STEP)},${Math.round(z / STEP)}`;
    const seen = new Set([key(SPAWN.x, SPAWN.z)]);
    const reached: { x: number; z: number }[] = [];
    const queue: { x: number; z: number }[] = [{ x: SPAWN.x, z: SPAWN.z }];
    while (queue.length) {
      const at = queue.pop()!;
      reached.push(at);
      for (const [dx, dz] of [
        [STEP, 0],
        [-STEP, 0],
        [0, STEP],
        [0, -STEP],
      ] as const) {
        const to = moveWithCollisions(at.x, at.z, dx, dz);
        if (Math.abs(to.x - (at.x + dx)) > 1e-9 || Math.abs(to.z - (at.z + dz)) > 1e-9) continue;
        const k = key(to.x, to.z);
        if (seen.has(k)) continue;
        seen.add(k);
        queue.push(to);
      }
    }
    const near = (p: { x: number; z: number }) =>
      reached.some((r) => Math.hypot(r.x - p.x, r.z - p.z) <= STEP);
    expect(near(SPAWN)).toBe(true);
    expect(near({ x: FLIGHT_CONTROL.x, z: FLIGHT_CONTROL.z - 1.4 })).toBe(true);
    expect(near(GARAGE_DOOR)).toBe(true);
    for (const c of CONSOLES) expect(near(consoleSeat(c, 1.25)), `console ${c.id}`).toBe(true);
  });
});
