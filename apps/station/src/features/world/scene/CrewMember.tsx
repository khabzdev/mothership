import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group, Mesh } from "three";
import { consoleSeat, type ConsoleDef } from "../layout";
import { useCharacter } from "./models";
import { STATUS_CHIPS, STATUS_COLORS } from "./status";

/** The clip a crew member plays for its status and current action (agent-office's stances). */
export function clipFor(crew: Pick<CrewInfo, "status" | "action">): string {
  switch (crew.status) {
    case "working":
      switch (crew.action) {
        case "read":
          return "Use_Item";
        case "web":
          return "Spellcasting";
        case "test":
          return "Block";
        case "failing":
          return "Hit_B";
        default:
          return "Interact";
      }
    case "needs_input":
      return "Spellcast_Raise";
    case "done":
      return "Cheer";
    case "asleep":
      return "Sit_Floor_Idle";
    default:
      return "Idle";
  }
}

/** A crew member at its console, acting out what its agent is doing. */
export function CrewMember({ crew, def }: { crew: CrewInfo; def: ConsoleDef }) {
  const { scene, animations } = useCharacter(crew.character);
  const body = useRef<Group>(null);
  const light = useRef<Mesh>(null);
  const { actions } = useAnimations(animations, body);
  const clip = clipFor(crew);
  const seat = consoleSeat(def, 0.85);

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
    <group position={[seat.x, 0, seat.z]} rotation={[0, def.rotY + Math.PI, 0]}>
      <group ref={body} scale={0.55}>
        <primitive object={scene} />
      </group>
      <mesh ref={light} position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshBasicMaterial color={STATUS_COLORS[crew.status]} toneMapped={false} />
      </mesh>
      <Html position={[0, 1.95, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
        <div className="crew-tag" data-status={crew.status}>
          <span className="crew-tag__name" style={{ color: crew.color }}>
            {crew.name}
          </span>
          <span className="crew-tag__chip">{STATUS_CHIPS[crew.status]}</span>
          {crew.task && <span className="crew-tag__task">{crew.task.split("\n")[0]}</span>}
        </div>
      </Html>
    </group>
  );
}
