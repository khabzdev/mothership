import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, Object3D, type Group, type InstancedMesh, type Mesh } from "three";
import { BOARDS, CONSOLES, DECK, consoleSeat } from "../layout";
import { useWorld } from "../store";
import type { CrewInfo } from "@mothership/protocol";
import { useProp } from "./models";

/** Seconds: the klaxon, then lift-off, then climbing out of sight. */
const LIFTOFF = 1.7;
const CLIMB = 6;
const PAD = { x: (BOARDS.mission.x + BOARDS.launch.x) / 2, z: DECK.minZ - 5 };
const CONFETTI = 160;
const COLORS = ["#ff5f1f", "#ffd166", "#06d6a0", "#5aa9ff", "#ef476f", "#f8f3e6"].map(
  (c) => new Color(c),
);

const dummy = new Object3D();

/**
 * A pull request just launched (agent-office's merge gong): a lander lifts off from behind the north
 * bulkhead into space, and confetti bursts over the console it came from (or the Launch board).
 */
export function LaunchShow({ crew }: { crew: CrewInfo[] }) {
  const launch = useWorld((s) => s.launch);
  const lander = useProp("lander_A");
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
    if (!launch) return;
    const t = (Date.now() - launch.at) / 1000;
    const s = ship.current;
    if (s) {
      const climb = Math.max(0, t - LIFTOFF);
      s.visible = t < LIFTOFF + CLIMB;
      // Rumbling on the pad, then accelerating up and away.
      s.position.set(
        PAD.x + (climb > 0 ? 0 : Math.sin(t * 60) * 0.03),
        climb * climb * 3,
        PAD.z - climb * 1.5,
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

  if (!launch) return null;
  return (
    <>
      <group ref={ship} position={[PAD.x, 0, PAD.z]}>
        <primitive object={lander} scale={2.2} />
        <mesh ref={flame} position={[0, -0.5, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.5, 1.6, 16, 1, true]} />
          <meshBasicMaterial color="#ffb020" transparent opacity={0.85} toneMapped={false} />
        </mesh>
      </group>
      <instancedMesh key={launch.at} ref={confetti} args={[undefined, undefined, CONFETTI]}>
        <planeGeometry args={[0.07, 0.11]} />
        <meshBasicMaterial side={2} toneMapped={false} />
      </instancedMesh>
    </>
  );
}
