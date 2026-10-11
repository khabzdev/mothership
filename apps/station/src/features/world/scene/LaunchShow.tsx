import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, type Group, type Mesh } from "three";
import { BOARDS, CONSOLES, LAUNCH_PAD, consoleSeat } from "../layout";
import { OUTPOST_SCALE, PAD_TOP } from "../outpost";
import { useWorld } from "../store";
import type { CrewInfo } from "@mothership/protocol";
import { Confetti } from "./Confetti";
import { GLOW } from "./materials";
import { LANDER_PIECE, LANDING_PAD_PIECE, useProp } from "./models";

/** Seconds: the klaxon, then lift-off, then climbing out of sight. */
const LIFTOFF = 1.7;
const CLIMB = 6;
/** The engine's flame, bright enough to bloom. */
const FLAME = new Color("#ffb020").multiplyScalar(GLOW);
const CONFETTI = 160;
const CONFETTI_S = 5;

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

  const burstAt = useMemo(() => {
    const from = crew.find((c) => c.id === launch?.crewId);
    const def = from && CONSOLES[from.consoleId];
    return def ? consoleSeat(def, 0) : { x: BOARDS.launch.x, z: BOARDS.launch.z + 1.2 };
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
        <Confetti
          key={launch.at}
          x={burstAt.x}
          z={burstAt.z}
          start={launch.at}
          count={CONFETTI}
          seconds={CONFETTI_S}
        />
      )}
    </>
  );
}
