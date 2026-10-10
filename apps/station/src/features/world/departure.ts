// A crew member sent home trudges to the garage on the outpost's south row and leaves through it:
// it pleads while the roll-up door goes up, walks in, and the door comes down on its cry.

/** Seconds for each beat once it reaches the garage door. */
export const GATE = { open: 0.8, step: 1.0, close: 0.8, gone: 0.4 };
/** How far it walks on from the door spot: 1.8 m to the door, then about 1.5 m into the garage. */
const IN = 3.3;
/** Walking pace to the garage (m/s): a trudge. */
export const TRUDGE = 1.9;

export const PLEAS = [
  "Wait, wait, wait!",
  "Let's talk about this!",
  "I'll fix the tests!",
  "One more chance!",
  "Is this thing on?",
];
export const CRIES = ["AAAAAAH!", "NOOOoooo…", "WHOAAAA!", "I regret nothiiing!", "Wheeeee!"];

type Point = { x: number; z: number };

export interface DepartureFrame {
  x: number;
  y: number;
  z: number;
  /** Which way it faces (radians about y, 0 = +z). */
  facing: number;
  walking: boolean;
  /** The garage door, 0 shut to 1 open. */
  door: number;
  /** In the garage, past the door. */
  inside: boolean;
  /** What it says over its head, if anything. */
  says: "plea" | "cry" | null;
  /** Reached the garage door (it's its turn from here on). */
  atDoor: boolean;
  done: boolean;
}

const length = (path: Point[]) =>
  path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z), 0);

/** How long the walk to the garage door takes (s). */
export const walkTime = (path: Point[]) => length(path) / TRUDGE;

/** Where along `path` it is after walking `d` metres, and which way it faces. */
function along(path: Point[], d: number): { x: number; z: number; facing: number } {
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1]!, path[i]!];
    const leg = Math.hypot(b.x - a.x, b.z - a.z);
    if (d <= leg || i === path.length - 1) {
      const t = leg ? Math.min(1, d / leg) : 1;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        facing: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    d -= leg;
  }
  return { ...path[0]!, facing: 0 };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** The departure `t` seconds after it set off along `path` (ending at the garage door). */
export function departure(path: Point[], t: number): DepartureFrame {
  const walk = walkTime(path);
  const door = path.at(-1)!;
  const from = path.at(-2) ?? door;
  // On in the way it came: up the last leg, through the door.
  const leg = Math.hypot(door.x - from.x, door.z - from.z) || 1;
  const inside = {
    x: door.x + ((door.x - from.x) / leg) * IN,
    z: door.z + ((door.z - from.z) / leg) * IN,
  };
  const frame: DepartureFrame = {
    ...along(path, t * TRUDGE),
    y: 0,
    walking: true,
    door: 0,
    inside: false,
    says: null,
    atDoor: false,
    done: false,
  };
  if (t < walk) return frame;

  let a = t - walk;
  Object.assign(frame, { ...door, walking: false, atDoor: true });
  const beats: (keyof typeof GATE)[] = ["open", "step", "close", "gone"];
  for (const beat of beats) {
    const k = clamp01(a / GATE[beat]);
    switch (beat) {
      case "open":
        frame.door = k;
        frame.says = "plea";
        break;
      case "step":
        frame.door = 1;
        frame.says = null;
        frame.walking = k < 1;
        frame.inside = k >= 1;
        frame.x = door.x + (inside.x - door.x) * k;
        frame.z = door.z + (inside.z - door.z) * k;
        break;
      case "close":
        frame.door = 1 - k;
        frame.says = "cry";
        break;
      case "gone":
        frame.door = 0;
        frame.says = null;
        frame.done = k >= 1;
        break;
    }
    if (a < GATE[beat]) return frame;
    a -= GATE[beat];
  }
  return frame;
}

/** Who may be at the garage door: whoever's already going through, else the first in line. */
export function nextAtDoor(queue: string[], busy: string | null): string | null {
  return busy ?? queue[0] ?? null;
}

/** How far back along the approach each place in the queue stands (m). */
export const QUEUE_GAP = 0.8;

/**
 * Where `id` stands in the line at the garage door. `queueAt` is when the corner before the door is
 * reached; each place in line waits `QUEUE_GAP` further back, so waiters don't stack on one point.
 * `limit` is the walk time it may not pass until its turn; `go` is whether it may go through now.
 */
export function queueTurn(
  queue: string[],
  busy: string | null,
  id: string,
  queueAt: number,
): { place: number; limit: number; go: boolean } {
  const i = queue.indexOf(id);
  const place = i >= 0 ? i : queue.length;
  const limit = Math.max(0, queueAt - (place * QUEUE_GAP) / TRUDGE);
  const line = i >= 0 ? queue : [...queue, id];
  return { place, limit, go: nextAtDoor(line, busy) === id };
}
