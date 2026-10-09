import { describe, expect, test } from "vite-plus/test";
import {
  CONSOLES,
  SPAWN,
  addCollider,
  consoleInReach,
  consoleSeat,
  moveWithCollisions,
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
});
