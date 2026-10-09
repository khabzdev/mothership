import { Euler, Quaternion, type Object3D } from "three";
import type { Act } from "../acting";

// Procedural offsets layered over a seated crew member's Sit_Chair_Idle clip, so it acts out its
// tool calls the way agent-office's workers do (worker-stance.ts): arms, lean and head.

const BONES = [
  "spine",
  "chest",
  "head",
  "upperarm.l",
  "lowerarm.l",
  "upperarm.r",
  "lowerarm.r",
] as const;
type Bone = (typeof BONES)[number];
type Turn = [x: number, y: number, z: number];
export type Pose = Partial<Record<Bone, Turn>>;

/** Dev only: force an act or a raw pose on every seated crew member, from the console. */
export const poseDebug: {
  act: Act | null;
  pose: Pose | null;
  scenes: Map<string, Object3D>;
} = { act: null, pose: null, scenes: new Map() };

// KayKit rig axes, measured on Sit_Chair_Idle: +x on an arm bone swings it forward and up, +z
// takes the left arm out and the right arm in; +x on the spine leans forward, +y twists it.

/** Both arms the same way, the left one's z mirrored onto the right. */
function arms(upper: number, lower: number, inward = 0, lowerR = lower, upperR = upper): Pose {
  return {
    "upperarm.l": [upper, 0, -inward],
    "upperarm.r": [upperR, 0, inward],
    "lowerarm.l": [lower, 0, 0],
    "lowerarm.r": [lowerR, 0, 0],
  };
}

/** The offsets for `act` at time `t` (s): agent-office's stances (worker-stance.ts). */
export function poseFor(act: Act, t: number): Pose {
  switch (act) {
    case "rest":
      return {};
    case "type":
      // Hands on the keys (chibi arms are short: it leans in to reach them).
      return {
        ...arms(0.85, 0.45 + Math.sin(t * 22) * 0.15, 0.2, 0.45 + Math.sin(t * 22 + 1.7) * 0.15),
        spine: [0.15 + Math.abs(Math.sin(t * 11)) * 0.02, 0, 0],
      };
    case "edit":
      // Hunched over the keys, typing flat out.
      return {
        ...arms(0.9, 0.5 + Math.sin(t * 34) * 0.25, 0.2, 0.5 + Math.sin(t * 34 + 1.9) * 0.25),
        spine: [0.28 + Math.abs(Math.sin(t * 17)) * 0.04, 0, 0],
        head: [0.1, 0, 0],
      };
    case "read":
      // Papers held up in front, eyes running down the page.
      return {
        ...arms(1.15, 1.2, 0.35),
        spine: [-0.06, 0, 0],
        head: [0.05 + ((t * 0.9) % 1) * 0.15, 0, 0],
      };
    case "test":
      // Leaning back, hands behind its head: waiting on the run.
      return {
        ...arms(2.5, 2.1, -0.5),
        spine: [-0.3, 0, Math.sin(t * 1.3) * 0.05],
        head: [-0.15, 0, 0],
      };
    case "web":
      // Scrolling with one hand, looking up at the globe.
      return {
        ...arms(0.55, 0.9 + Math.sin(t * 9) * 0.15, 0.15, 0, 0),
        spine: [-0.1, 0, 0],
        head: [-0.3, 0, 0],
      };
    case "failing":
      // Head in its hands, shaking it slowly.
      return {
        ...arms(1.25, 2.3, 0.55),
        spine: [0.6, Math.sin(t * 2.4) * 0.16, 0],
        head: [0.25, 0, 0],
      };
  }
}

const turn = new Quaternion();
const euler = new Euler();

/** Eases a character's bones toward a pose each frame, on top of what its animation set. */
export class PoseLayer {
  readonly #bones = new Map<Bone, Object3D>();
  readonly #now = new Map<Bone, Turn>();
  /** What each bone was left at last frame, and the offset that was put on it. */
  readonly #left = new Map<Bone, { at: Quaternion; offset: Quaternion }>();

  constructor(root: Object3D) {
    for (const name of BONES) {
      // GLTFLoader drops the dots from node names.
      const bone = root.getObjectByName(name) ?? root.getObjectByName(name.replace(".", ""));
      if (bone) this.#bones.set(name, bone);
    }
  }

  /** Call after the animation mixer has updated this frame. */
  apply(target: Pose, dt: number): void {
    const k = Math.min(1, dt * 8);
    for (const [name, bone] of this.#bones) {
      const want = target[name] ?? [0, 0, 0];
      const now = this.#now.get(name) ?? [0, 0, 0];
      for (let i = 0; i < 3; i++) now[i] = now[i]! + (want[i]! - now[i]!) * k;
      this.#now.set(name, now);
      const left = this.#left.get(name) ?? { at: new Quaternion(), offset: new Quaternion() };
      // Nothing animated this bone since (its clip has faded out): take last frame's offset off first.
      if (bone.quaternion.equals(left.at))
        bone.quaternion.multiply(turn.copy(left.offset).invert());
      left.offset.setFromEuler(euler.set(now[0], now[1], now[2]));
      bone.quaternion.multiply(left.offset);
      left.at.copy(bone.quaternion);
      this.#left.set(name, left);
    }
  }
}
