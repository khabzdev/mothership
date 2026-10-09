import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group, Mesh } from "three";
import { consoleSeat, type ConsoleDef } from "../layout";
import { Beacon } from "./Beacon";
import { KAYKIT_SCALE, useCharacter } from "./models";
import { STATUS_CHIPS, STATUS_COLORS } from "./status";

/** Seated at the console unless it's waving for you or celebrating (agent-office's stances). */
export function stanceFor(crew: Pick<CrewInfo, "status" | "action">): {
  clip: string;
  seated: boolean;
} {
  switch (crew.status) {
    case "needs_input":
      return { clip: "Spellcast_Raise", seated: false };
    case "done":
      return { clip: "Cheer", seated: false };
    default:
      return { clip: "Sit_Chair_Idle", seated: true };
  }
}

/** A crew member at its console, acting out what its agent is doing. */
export function CrewMember({ crew, def }: { crew: CrewInfo; def: ConsoleDef }) {
  const { scene, animations } = useCharacter(crew.character);
  const body = useRef<Group>(null);
  const light = useRef<Mesh>(null);
  const { actions } = useAnimations(animations, body);
  const { clip, seated } = stanceFor(crew);
  // Seated in the console's chair, or standing just behind it.
  const seat = consoleSeat(def, seated ? 0.85 : 1.45);

  useEffect(() => {
    const action = actions[clip] ?? actions.Idle;
    action?.reset().fadeIn(0.25).play();
    return () => void action?.fadeOut(0.25);
  }, [actions, clip]);

  useFrame(({ clock }) => {
    if (!light.current) return;
    const pulse = crew.status === "needs_input" ? 1 + Math.sin(clock.elapsedTime * 8) * 0.35 : 1;
    light.current.scale.setScalar(pulse);
  });

  return (
    <>
      {crew.status === "needs_input" && <Beacon x={seat.x} z={seat.z} top={2.6} />}
      <group position={[seat.x, 0, seat.z]} rotation={[0, def.rotY + Math.PI, 0]}>
        <group ref={body} scale={KAYKIT_SCALE}>
          <primitive object={scene} />
        </group>
        <mesh ref={light} position={[0, seated ? 1.45 : 1.85, 0]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={STATUS_COLORS[crew.status]} toneMapped={false} />
        </mesh>
        <Html position={[0, seated ? 1.9 : 2.3, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
          <div className="crew-tag" data-status={crew.status}>
            <span className="crew-tag__name" style={{ color: crew.color }}>
              {crew.name}
            </span>
            <span className="crew-tag__chip">{STATUS_CHIPS[crew.status]}</span>
            {crew.task && <span className="crew-tag__task">{crew.task.split("\n")[0]}</span>}
          </div>
        </Html>
      </group>
    </>
  );
}
