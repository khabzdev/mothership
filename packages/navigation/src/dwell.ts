import { sameWaypoint, type Waypoint } from "./waypoints.ts";

/** Minimum time a crew member stays at a waypoint before walking on. */
export const MIN_DWELL_MS = 2000;

export interface Dwell {
  current: Waypoint;
  /** When the crew member arrived at `current` (ms). */
  since: number;
  /** Latest move requested before the dwell elapsed. */
  pending?: Waypoint;
}

export interface DwellResult {
  dwell: Dwell;
  /** Set when the crew member should start walking to a new waypoint. */
  move?: Waypoint;
}

export interface DwellOptions {
  minDwellMs?: number;
}

export function createDwell(now: number): Dwell {
  return { current: { kind: "quarters" }, since: now };
}

/** Ask to move to `next`. Moves now, or holds it as pending until the dwell elapses. */
export function propose(
  dwell: Dwell,
  next: Waypoint,
  now: number,
  options: DwellOptions = {},
): DwellResult {
  if (sameWaypoint(dwell.current, next)) {
    return { dwell: { current: dwell.current, since: dwell.since } };
  }
  const urgent = next.kind === "bridgeRail";
  if (urgent || now - dwell.since >= (options.minDwellMs ?? MIN_DWELL_MS)) {
    return { dwell: { current: next, since: now }, move: next };
  }
  return { dwell: { ...dwell, pending: next } };
}

/** Call periodically: releases a pending move once the dwell has elapsed. */
export function tick(dwell: Dwell, now: number, options: DwellOptions = {}): DwellResult {
  if (!dwell.pending) return { dwell };
  if (now - dwell.since < (options.minDwellMs ?? MIN_DWELL_MS)) return { dwell };
  return { dwell: { current: dwell.pending, since: now }, move: dwell.pending };
}
