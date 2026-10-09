import { useAnimations } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MathUtils, Vector3, type Group } from "three";
import { CONSOLES, SPAWN, consoleInReach, consoleSeat, moveWithCollisions } from "../layout";
import { gameKeysEnabled, useWorld } from "../store";
import { KAYKIT_SCALE, useCharacter } from "./models";
import { poseDebug } from "./pose";

// agent-office's player tuning (src/client/player).
const WALK = 4.6;
const RUN = 7.5;
const CAMERA = { distance: 7.5, pitch: 0.42, height: 1.4, minDistance: 3, maxDistance: 16 };

/** Where the Captain is, for systems outside the scene (e.g. jumping to a crew member). */
export const captain: { x: number; z: number; facing: number; snap: boolean } = {
  x: SPAWN.x,
  z: SPAWN.z,
  facing: Math.PI,
  /** Swing the camera round behind the Captain on the next frame (after a jump). */
  snap: false,
};

/** Put the Captain behind a console's crew member, facing the console (agent-office's N jump). */
export function jumpTo(consoleId: number): void {
  const def = CONSOLES[consoleId];
  if (!def) return;
  // Behind the crew member, standing or seated, looking over its shoulder at the console.
  const spot = consoleSeat(def, 2.2);
  captain.x = spot.x + Math.cos(def.rotY) * 0.7;
  captain.z = spot.z - Math.sin(def.rotY) * 0.7;
  captain.facing = def.rotY + Math.PI;
  captain.snap = true;
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.assign(window, { __mothership: { captain, jumpTo, poseDebug } });
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** You: the Knight in a flight suit. WASD walks relative to the camera; drag orbits, wheel zooms. */
export function Captain() {
  const { scene, animations } = useCharacter("Knight");
  const body = useRef<Group>(null);
  const { actions } = useAnimations(animations, body);
  const { camera, gl } = useThree();
  const held = useRef(new Set<string>());
  const view = useRef({ yaw: 0.6, pitch: CAMERA.pitch, distance: CAMERA.distance });
  const clip = useRef("Idle");
  const setConsole = useWorld((s) => s.setConsole);

  useEffect(() => {
    actions.Idle?.reset().play();
    const down = (e: KeyboardEvent) => {
      if (!gameKeysEnabled(e)) return;
      if (e.code in MOVE_KEYS || e.code === "ShiftLeft" || e.code === "ShiftRight")
        held.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => held.current.delete(e.code);
    const clear = () => held.current.clear();
    const offOverlay = useWorld.subscribe((s) => s.overlay && clear());

    let dragging = false;
    const canvas = gl.domElement;
    const press = () => (dragging = true);
    const release = () => (dragging = false);
    const drag = (e: PointerEvent) => {
      if (!dragging) return;
      view.current.yaw -= e.movementX * 0.005;
      view.current.pitch = MathUtils.clamp(view.current.pitch + e.movementY * 0.004, 0.1, 1.25);
    };
    const zoom = (e: WheelEvent) => {
      e.preventDefault();
      view.current.distance = MathUtils.clamp(
        view.current.distance + e.deltaY * 0.01,
        CAMERA.minDistance,
        CAMERA.maxDistance,
      );
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    canvas.addEventListener("pointerdown", press);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointermove", drag);
    canvas.addEventListener("wheel", zoom, { passive: false });
    return () => {
      offOverlay();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      canvas.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointermove", drag);
      canvas.removeEventListener("wheel", zoom);
    };
  }, [actions, gl]);

  const target = new Vector3();
  const desired = new Vector3();

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (captain.snap) {
      view.current.yaw = captain.facing + Math.PI;
      captain.snap = false;
    }
    let ix = 0;
    let iz = 0;
    for (const code of held.current) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        ix += dir[0];
        iz += dir[1];
      }
    }
    const moving = ix !== 0 || iz !== 0;
    const running = held.current.has("ShiftLeft") || held.current.has("ShiftRight");

    if (moving) {
      // Rotate input by the camera's yaw so "W" walks away from the camera.
      const { yaw } = view.current;
      const len = Math.hypot(ix, iz);
      const fx = ix / len;
      const fz = iz / len;
      const wx = fx * Math.cos(yaw) + fz * Math.sin(yaw);
      const wz = -fx * Math.sin(yaw) + fz * Math.cos(yaw);
      const step = (running ? RUN : WALK) * dt;
      const next = moveWithCollisions(captain.x, captain.z, wx * step, wz * step);
      captain.x = next.x;
      captain.z = next.z;
      const facing = Math.atan2(wx, wz);
      let diff = facing - captain.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      captain.facing += diff * Math.min(1, dt * 14);
    }

    const wanted = moving ? (running ? "Running_A" : "Walking_A") : "Idle";
    if (wanted !== clip.current) {
      actions[clip.current]?.fadeOut(0.2);
      actions[wanted]?.reset().fadeIn(0.2).play();
      clip.current = wanted;
    }

    body.current?.position.set(captain.x, 0, captain.z);
    if (body.current) body.current.rotation.y = captain.facing;

    const { yaw, pitch, distance } = view.current;
    target.set(captain.x, CAMERA.height, captain.z);
    desired.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    camera.position.lerp(desired, 0.25);
    camera.lookAt(target);

    setConsole(consoleInReach(captain.x, captain.z)?.id ?? null);
  });

  return (
    <group ref={body} scale={KAYKIT_SCALE}>
      <primitive object={scene} />
    </group>
  );
}
