import { AIRLOCK } from "./layout";

// A crew member sent home walks to the airlock and is put out of it (agent-office's space station,
// features/workers/eject.ts): the inner door goes up, it steps in, the door comes down, the lights
// go red while it pleads, then the outer hatch parts and it's blown out into space, tumbling.

/** Seconds for each beat once it reaches the inner door. */
export const EJECT = {
  open: 0.5,
  step: 0.6,
  seal: 0.5,
  wait: 1.8,
  part: 0.22,
  blow: 5.5,
  shut: 0.8,
};
/** Walking pace to the airlock (m/s): a trudge. */
export const TRUDGE = 1.9;

export const PLEAS = [
  "😨 Wait, wait, wait!",
  "🥺 Let's talk about this!",
  "😰 I'll fix the tests!",
  "🙏 One more chance!",
  "😳 Is this thing on?",
];
export const CRIES = [
  "😱 AAAAAAH!",
  "😵 NOOOoooo…",
  "🫨 WHOAAAA!",
  "😭 I regret nothiiing!",
  "🚀 Wheeeee!",
];

type Point = { x: number; z: number };

export interface DepartureFrame {
  x: number;
  y: number;
  z: number;
  /** Which way it faces (radians about y, 0 = +z). */
  facing: number;
  /** Tumbling once blown out (radians). */
  tumble: number;
  walking: boolean;
  /** Inner door and outer hatch, 0 shut to 1 open; red lights on. */
  inner: number;
  outer: number;
  red: boolean;
  /** What it says over its head, if anything. */
  says: "plea" | "cry" | null;
  /** Reached the airlock (it's its turn from here on). */
  atLock: boolean;
  done: boolean;
}

const length = (path: Point[]) =>
  path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i]!.x, p.z - path[i]!.z), 0);

/** How long the walk to the inner door takes (s). */
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

/** The departure `t` seconds after it set off along `path` (ending at the inner door). */
export function departure(path: Point[], t: number): DepartureFrame {
  const walk = walkTime(path);
  const door = path.at(-1)!;
  const inside = { x: AIRLOCK.x + AIRLOCK.depth / 2, z: AIRLOCK.z };
  const east = Math.PI / 2;
  const frame: DepartureFrame = {
    ...along(path, t * TRUDGE),
    y: 0,
    tumble: 0,
    walking: true,
    inner: 0,
    outer: 0,
    red: false,
    says: null,
    atLock: false,
    done: false,
  };
  if (t < walk) return frame;

  let a = t - walk;
  Object.assign(frame, { ...door, facing: east, walking: false, atLock: true });
  const beats: (keyof typeof EJECT)[] = ["open", "step", "seal", "wait", "part", "blow", "shut"];
  for (const beat of beats) {
    const k = clamp01(a / EJECT[beat]);
    switch (beat) {
      case "open":
        frame.inner = k;
        break;
      case "step":
        frame.inner = 1;
        frame.walking = k < 1;
        frame.x = door.x + (inside.x - door.x) * k;
        break;
      case "seal":
        frame.x = inside.x;
        frame.inner = 1 - k;
        frame.facing = east + Math.PI * k;
        break;
      case "wait":
        frame.red = true;
        frame.says = "plea";
        break;
      case "part":
        frame.red = true;
        frame.outer = k;
        break;
      case "blow": {
        frame.outer = 1;
        frame.red = true;
        frame.says = "cry";
        // Out of the hatch fast, then drifting off and up.
        const eased = 1 - (1 - k) ** 3;
        frame.x = inside.x + eased * 28;
        frame.y = eased * 6;
        frame.z = inside.z + eased * 4;
        frame.tumble = a * 3.2;
        break;
      }
      case "shut":
        frame.outer = 1 - k;
        frame.red = false;
        frame.says = null;
        frame.done = k >= 1;
        break;
    }
    if (a < EJECT[beat]) return frame;
    a -= EJECT[beat];
  }
  return frame;
}
