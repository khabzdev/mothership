import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Color,
  Object3D,
  type Group,
  type InstancedMesh,
  type Mesh,
} from "three";
import { BOARDS, CONSOLES, LAUNCH_PAD, consoleSeat } from "../layout";
import { OUTPOST_SCALE, PAD_TOP } from "../outpost";
import { useWorld } from "../store";
import type { CrewInfo } from "@mothership/protocol";
import { GLOW } from "./materials";
import { LANDER_PIECE, LANDING_PAD_PIECE, useProp } from "./models";

/** Seconds: the klaxon, then lift-off, then climbing out of sight. */
const LIFTOFF = 1.7;
const CLIMB = 6;
/** The engine's flame, bright enough to bloom. */
const FLAME = new Color("#ffb020").multiplyScalar(GLOW);
const CONFETTI = 160;
const COLORS = ["#ff5f1f", "#ffd166", "#06d6a0", "#5aa9ff", "#ef476f", "#f8f3e6"].map(
  (c) => new Color(c),
);

const dummy = new Object3D();

/**
 * A pull request just launched (agent-office's merge gong): a lander lifts off from the pad at the island's north-east
 * into space, and confetti bursts over the console it came from (or the Launch board).
 */
export function LaunchShow({ crew }: { crew: CrewInfo[] }) {
  const launch = useWorld((s) => s.launch);
  const lander = useProp(LANDER_PIECE);
  const pad = useProp(LANDING_PAD_PIECE);
  const ship = useRef<Group>(null);
  const flame = useRef<Mesh>(null);
  const confetti = useRef<InstancedMesh>(null);

  const burst = useMemo(() => {
    const from = crew.find((c) => c.id === launch?.crewId);
    const def = from && CONSOLES[from.consoleId];
    const at = def ? consoleSeat(def, 0) : { x: BOARDS.launch.x, z: BOARDS.launch.z + 1.2 };
    // Each piece: where it starts (over the burst), its velocity and spin.
    const pieces = Array.from({ length: CONFETTI }, (_, i) => {
      const a = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 3;
      return {
        v: [Math.cos(a) * speed, 4 + Math.random() * 4, Math.sin(a) * speed],
        spin: Math.random() * 10,
        color: COLORS[i % COLORS.length]!,
      };
    });
    return { at, pieces };
  }, [launch, crew]);

  useFrame(() => {
    const t = launch ? (Date.now() - launch.at) / 1000 : Infinity;
    const s = ship.current;
    // At rest, or once the show is over, the lander stands on its pad.
    if (!launch || t >= LIFTOFF + CLIMB) {
      if (s) {
        s.visible = true;
        s.position.set(LAUNCH_PAD.x, PAD_TOP, LAUNCH_PAD.z);
        s.rotation.z = 0;
      }
      if (flame.current) flame.current.visible = false;
      if (confetti.current) confetti.current.visible = false;
      return;
    }
    if (s) {
      const climb = Math.max(0, t - LIFTOFF);
      s.visible = true;
      // Rumbling on the pad, then accelerating up and away.
      s.position.set(
        LAUNCH_PAD.x + (climb > 0 ? 0 : Math.sin(t * 60) * 0.03),
        PAD_TOP + climb * climb * 3,
        LAUNCH_PAD.z - climb * 1.5,
      );
      s.rotation.z = Math.sin(climb * 2) * 0.05;
    }
    if (flame.current) {
      flame.current.visible = t > LIFTOFF - 0.6 && t < LIFTOFF + CLIMB;
      flame.current.scale.set(
        1,
        1 + Math.random() * 0.6 + Math.min(1, Math.max(0, t - LIFTOFF)),
        1,
      );
    }
    const c = confetti.current;
    if (c) {
      c.visible = t < 5;
      if (!c.visible) return;
      burst.pieces.forEach((p, i) => {
        const y = 2.6 + p.v[1]! * t - 4.9 * t * t * 0.35;
        dummy.position.set(
          burst.at.x + p.v[0]! * t * 0.6,
          Math.max(0.02, y),
          burst.at.z + p.v[2]! * t * 0.6,
        );
        dummy.rotation.set(p.spin * t, p.spin * t * 0.7, 0);
        dummy.updateMatrix();
        c.setMatrixAt(i, dummy.matrix);
        c.setColorAt(i, p.color);
      });
      c.instanceMatrix.needsUpdate = true;
      if (c.instanceColor) c.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={pad} position={[LAUNCH_PAD.x, 0, LAUNCH_PAD.z]} scale={OUTPOST_SCALE} />
      <group ref={ship} position={[LAUNCH_PAD.x, PAD_TOP, LAUNCH_PAD.z]}>
        <primitive object={lander} scale={OUTPOST_SCALE} />
        <mesh ref={flame} visible={false} position={[0, -0.5, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.5, 1.6, 16, 1, true]} />
          <meshBasicMaterial
            color={FLAME}
            transparent
            opacity={0.9}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      {launch && (
        <instancedMesh key={launch.at} ref={confetti} args={[undefined, undefined, CONFETTI]}>
          <planeGeometry args={[0.07, 0.11]} />
          <meshBasicMaterial side={2} toneMapped={false} />
        </instancedMesh>
      )}
    </>
  );
}
