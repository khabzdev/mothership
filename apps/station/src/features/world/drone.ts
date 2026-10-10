import type { CrewInfo } from "@mothership/protocol";
import { consoleSeat, type ConsoleDef } from "./layout";

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
