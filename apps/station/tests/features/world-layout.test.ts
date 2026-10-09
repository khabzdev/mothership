import { describe, expect, test } from "vite-plus/test";
import {
  CONSOLES,
  SPAWN,
  AIRLOCK,
  COLLIDERS,
  addCollider,
  BOARDS,
  LIFT_STOP,
  boardInReach,
  airlockPath,
  liftInReach,
  partnerOf,
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

  test("every crew member's way to the airlock stays clear of the consoles", () => {
    for (const c of CONSOLES) {
      const path = airlockPath(c);
      expect(path.at(-1)).toEqual({ x: AIRLOCK.x - 0.7, z: AIRLOCK.z });
      // Skip the first leg: that's getting up out of its own chair.
      for (let i = 1; i < path.length - 1; i++) {
        const [a, b] = [path[i]!, path[i + 1]!];
        for (let t = 0; t <= 1; t += 0.02) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const inside = COLLIDERS.some(
            (box) => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ,
          );
          expect(inside, `console ${c.id} leg ${i} at ${x},${z}`).toBe(false);
        }
      }
    }
  });

  test("every console has one partner back to back across the desk", () => {
    for (const c of CONSOLES) {
      const p = partnerOf(c)!;
      expect(partnerOf(p)?.id).toBe(c.id);
      expect(p.rotY).not.toBe(c.rotY);
    }
  });

  test("you call the lift from in front of its doors, clear of any console", () => {
    expect(liftInReach(LIFT_STOP.x, LIFT_STOP.z)).toBe(true);
    expect(liftInReach(SPAWN.x, SPAWN.z)).toBe(false);
    expect(consoleInReach(LIFT_STOP.x, LIFT_STOP.z)).toBeNull();
    expect(moveWithCollisions(LIFT_STOP.x, LIFT_STOP.z, 0, 0)).toEqual(LIFT_STOP);
  });

  test("you read a board standing in front of it, not from the consoles", () => {
    expect(boardInReach(BOARDS.mission.x, BOARDS.mission.z + 1.5)).toBe("mission");
    expect(boardInReach(BOARDS.launch.x + 1, BOARDS.launch.z + 1)).toBe("launch");
    for (const c of CONSOLES) {
      const seat = consoleSeat(c, 1.25);
      expect(boardInReach(seat.x, seat.z)).toBeNull();
    }
  });
});
