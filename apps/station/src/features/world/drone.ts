import type { CrewInfo } from "@mothership/protocol";
import { consoleSeat, INSPECTOR_DOCK, type ConsoleDef } from "./layout";

// The Inspector drone's moves: where it goes, how it flies there and how it reacts to a verdict.
// Pure and allocation-free, so the scene can call it every frame.

/** How high the drone hovers over a console it's inspecting (m): above the crew name tags, low enough to read over its console. */
export const HOVER_Y = 2.3;
/** How much bigger the drone is drawn than its modelled size, so it reads from the default camera. */
export const DRONE_SCALE = 1.4;
/** How high it hovers over its pad. */
export const DOCK_Y = 0.9;
/** How long a flight takes (s). */
export const FLY_S = 1.2;
/** How long a verdict beat lasts before it flies home (s). */
export const VERDICT_S = 1.5;
/** Facing the deck from the pad (its front is +z; the deck lies north, -z). */
export const DOCK_FACING = Math.PI;
/** How long it waits once its review is gone before heading home: the verdict may still be on its way. */
export const LINGER_S = 0.4;

/** How far the arc rises over the higher end of a flight. */
const ARC = 0.8;
/** Where it hovers along the console's depth: negative is beyond the monitor, away from the crew member (m). */
const BEYOND_SCREEN = -0.7;
const SHAKE = 0.25;
const SHAKES = 3;
const SHRUG = 0.35;
const BOB = 0.06;
const BOB_HZ = 0.5;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type DroneBeat =
  | "idle"
  | "flying"
  | "scanning"
  | "cleared"
  | "flagged"
  | "failed"
  | "returning";

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Where a flight from `from` to `to` is at `t` (0 to 1, clamped): eased on x and z, arcing up to
 * 0.8 m over the higher end. Written into `out`.
 */
export function droneFlight(from: Vec3, to: Vec3, t: number, out: Vec3): Vec3 {
  const u = Math.min(1, Math.max(0, t));
  const s = smoothstep(u);
  out.x = from.x + (to.x - from.x) * s;
  out.z = from.z + (to.z - from.z) * s;
  const lift = Math.max(from.y, to.y) + ARC - (from.y + to.y) / 2;
  out.y = from.y + (to.y - from.y) * s + lift * 4 * u * (1 - u);
  return out;
}

/**
 * The crew member being reviewed, and where the drone hovers for it: just beyond its console's
 * screen (on the side away from the crew member), facing the screen and the crew member.
 * The lowest console's running review that isn't queued.
 */
export function droneTarget(
  roster: CrewInfo[],
  consoles: ConsoleDef[],
): { crewId: string; x: number; z: number; facing: number } | null {
  let best: { member: CrewInfo; def: ConsoleDef } | null = null;
  for (const member of roster) {
    const info = member.inspection;
    if (info?.state !== "running" || info.queued) continue;
    if (best && member.consoleId >= best.member.consoleId) continue;
    const def = consoles.find((c) => c.id === member.consoleId);
    if (def) best = { member, def };
  }
  if (!best) return null;
  const spot = consoleSeat(best.def, BEYOND_SCREEN);
  return { crewId: best.member.id, ...spot, facing: best.def.rotY };
}

/** The eye's colour for a beat. */
export function eyeColor(beat: DroneBeat): "cyan" | "green" | "red" | "amber" | "dim" {
  switch (beat) {
    case "flying":
    case "scanning":
      return "cyan";
    case "cleared":
      return "green";
    case "flagged":
      return "red";
    case "failed":
      return "amber";
    default:
      return "dim";
  }
}

/**
 * The drone's offset from where it hovers, in its own frame (x is its side): the idle bob (`t` is
 * the clock), a "shake no" for flagged and a slow drop-and-return for failed (`t` since the beat
 * began). Written into `out`.
 */
export function beatOffset(beat: DroneBeat, t: number, out: Vec3): Vec3 {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  const u = Math.min(1, Math.max(0, t / VERDICT_S));
  if (beat === "idle") out.y = BOB * Math.sin(2 * Math.PI * BOB_HZ * t);
  else if (beat === "flagged") out.x = SHAKE * Math.sin(2 * Math.PI * SHAKES * u);
  else if (beat === "failed") out.y = -SHRUG * Math.sin(Math.PI * u);
  return out;
}

/** A beat that plays a verdict. */
export type Verdict = Extract<DroneBeat, "cleared" | "flagged" | "failed">;

/** Where the drone goes for a review (see droneTarget). */
export type DroneSpot = NonNullable<ReturnType<typeof droneTarget>>;

/** The drone's flight, stepped in place each frame by droneStep. */
export interface DroneState {
  beat: DroneBeat;
  /** When the beat (or flight) began, on the frame clock (s). */
  since: number;
  from: Vec3;
  to: Vec3;
  fromFacing: number;
  toFacing: number;
  /** The crew member it's flying to or scanning. */
  crewId: string | null;
  /** When its review left the roster (s), or -1 while it's there. */
  lostAt: number;
  /** A verdict heard over the hub, played on the next step. */
  heard: Verdict | null;
  /** Where it is now (before beatOffset), and which way it faces. */
  at: Vec3;
  facing: number;
}

/** The drone idle on its pad. */
export function restingDrone(): DroneState {
  const pad = () => ({ x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z });
  return {
    beat: "idle",
    since: 0,
    from: pad(),
    to: pad(),
    fromFacing: DOCK_FACING,
    toFacing: DOCK_FACING,
    crewId: null,
    lostAt: -1,
    heard: null,
    at: pad(),
    facing: DOCK_FACING,
  };
}

/**
 * Hear a verdict for `crewId`: its own review's, or (resting at or flying home to its pad) one it
 * never got to fly to. Whether it will play.
 */
export function hearVerdict(s: DroneState, crewId: string, verdict: Verdict): boolean {
  const resting = s.beat === "idle" || s.beat === "returning";
  if (s.crewId !== crewId && !resting) return false;
  s.heard = verdict;
  return true;
}

/** The shortest way round from angle `a` to `b`, `s` of the way (0 to 1). */
function turn(a: number, b: number, s: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * s;
}

const setVec = (v: Vec3, x: number, y: number, z: number) => {
  v.x = x;
  v.y = y;
  v.z = z;
};

/** Start a flight from where it is to (x, y, z), facing `toFacing`. */
function fly(
  s: DroneState,
  now: number,
  beat: DroneBeat,
  x: number,
  y: number,
  z: number,
  toFacing: number,
): void {
  s.beat = beat;
  s.since = now;
  setVec(s.from, s.at.x, s.at.y, s.at.z);
  setVec(s.to, x, y, z);
  s.fromFacing = s.facing;
  s.toFacing = toFacing;
}

/** Fly to the review under way, or home to the pad when there's none. */
function moveOn(s: DroneState, now: number, next: DroneSpot | null): void {
  s.lostAt = -1;
  s.crewId = next?.crewId ?? null;
  if (next) fly(s, now, "flying", next.x, HOVER_Y, next.z, next.facing);
  else fly(s, now, "returning", INSPECTOR_DOCK.x, DOCK_Y, INSPECTOR_DOCK.z, DOCK_FACING);
}

/**
 * One frame of the drone's flight at `now` (s), with `next` the review under way: a heard verdict
 * plays where it is, then it moves on; it flies to a new review, lingers a moment when its review
 * goes (the verdict may be on its way) and then heads home. Updates `s` in place, `at` and
 * `facing` included; allocates nothing.
 */
export function droneStep(s: DroneState, now: number, next: DroneSpot | null): DroneState {
  if (s.heard) {
    s.beat = s.heard;
    s.since = now;
    s.crewId = null;
    s.heard = null;
    // Settle where it is: a flight cut short stops here.
    setVec(s.from, s.at.x, s.at.y, s.at.z);
    setVec(s.to, s.at.x, s.at.y, s.at.z);
    s.fromFacing = s.toFacing = s.facing;
  }
  const verdict = s.beat === "cleared" || s.beat === "flagged" || s.beat === "failed";
  const elapsed = now - s.since;
  if (next) s.lostAt = -1;
  if (verdict) {
    if (elapsed >= VERDICT_S) moveOn(s, now, next);
  } else if (next && next.crewId !== s.crewId) {
    moveOn(s, now, next);
  } else if (!next && s.crewId) {
    if (s.lostAt < 0) s.lostAt = now;
    else if (now - s.lostAt >= LINGER_S) moveOn(s, now, null);
  } else if (s.beat === "flying" && elapsed >= FLY_S) {
    s.beat = "scanning";
  } else if (s.beat === "returning" && elapsed >= FLY_S) {
    s.beat = "idle";
  }

  const t = (now - s.since) / FLY_S;
  droneFlight(s.from, s.to, s.beat === "flying" || s.beat === "returning" ? t : 1, s.at);
  s.facing = turn(s.fromFacing, s.toFacing, Math.min(1, Math.max(0, t)));
  return s;
}
