import { afterEach, describe, expect, test } from "vite-plus/test";
import { CONSOLES, SHIP_STOP, consoleSeat, shipInReach } from "../../src/features/world/layout.ts";
import {
  CLIMB_HEIGHT,
  SHIP_TIMING,
  canCancel,
  flightOutcome,
  rideAction,
  shipPose,
} from "../../src/features/world/ship.ts";
import { useWorld } from "../../src/features/world/store.ts";

describe("your ship", () => {
  test("you board it from its stop, not from 2 m away or any console seat", () => {
    expect(shipInReach(SHIP_STOP.x, SHIP_STOP.z)).toBe(true);
    expect(shipInReach(SHIP_STOP.x + 2, SHIP_STOP.z)).toBe(false);
    expect(shipInReach(SHIP_STOP.x, SHIP_STOP.z + 2)).toBe(false);
    for (const c of CONSOLES) {
      const seat = consoleSeat(c, 0.85);
      expect(shipInReach(seat.x, seat.z)).toBe(false);
    }
  });

  test("take-off: it rumbles on the pad, then climbs, then it's gone", () => {
    const rumble = shipPose("takeoff", 0.2);
    expect(rumble.y).toBe(0);
    expect(rumble.shake).toBeGreaterThan(0);
    expect(rumble.cancellable).toBe(true);
    expect(rumble.done).toBe(false);

    const climbing = shipPose("takeoff", SHIP_TIMING.rumble + 0.6);
    expect(climbing.y).toBeGreaterThan(0);
    expect(climbing.y).toBeLessThan(CLIMB_HEIGHT);
    expect(climbing.flame).toBe(1);
    expect(climbing.cancellable).toBe(false);
    expect(climbing.done).toBe(false);

    expect(shipPose("takeoff", 1.6).done).toBe(true);
  });

  test("landing: it comes down from above with its flame lit, and settles on the pad", () => {
    const start = shipPose("landing", 0);
    expect(start.y).toBeGreaterThan(0);
    expect(start.flame).toBeGreaterThan(0);
    expect(start.done).toBe(false);
    const end = shipPose("landing", SHIP_TIMING.land);
    expect(end.y).toBe(0);
    expect(end.done).toBe(true);
  });

  test("Escape cancels only while the ship is still rumbling on the pad", () => {
    const flight = { to: "d2", at: 10_000 };
    expect(canCancel(flight, 10_200)).toBe(true);
    expect(canCancel(flight, 11_000)).toBe(false);
    expect(canCancel(null, 10_200)).toBe(false);
  });

  test("a take-off flies on to the picked deck only from the deck it left, if that deck's still there", () => {
    const flight = { to: "d2", from: "d1" };
    expect(flightOutcome(flight, "d1", ["d1", "d2"])).toBe("fly");
    // Switched to another deck from the top bar or palette mid-flight.
    expect(flightOutcome(flight, "d3", ["d1", "d2", "d3"])).toBe("end");
    // The picked deck was undocked mid-flight.
    expect(flightOutcome(flight, "d1", ["d1"])).toBe("end");
  });

  test("picking a deck: fly from the ship, switch from anywhere else, stay on your own deck", () => {
    expect(rideAction(true, "d2", "d1")).toBe("fly");
    expect(rideAction(false, "d2", "d1")).toBe("choose");
    expect(rideAction(true, "d1", "d1")).toBe("stay");
    expect(rideAction(false, "d1", "d1")).toBe("stay");
  });
});

describe("flight state", () => {
  afterEach(() => useWorld.setState({ flight: null, arriving: false }));

  test("starting a flight records where to and when; cancelling clears it", () => {
    useWorld.getState().startFlight("d2", "d1");
    expect(useWorld.getState().flight).toEqual({ to: "d2", from: "d1", at: expect.any(Number) });
    useWorld.getState().cancelFlight();
    expect(useWorld.getState().flight).toBeNull();
  });

  test("ending a flight clears it; arriving is its own flag", () => {
    useWorld.getState().startFlight("d2", "d1");
    useWorld.getState().setArriving(true);
    useWorld.getState().endFlight();
    expect(useWorld.getState().flight).toBeNull();
    expect(useWorld.getState().arriving).toBe(true);
  });
});
