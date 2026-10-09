import type { CrewInfo } from "@mothership/protocol";
import { CONSOLE_SIZE, type ConsoleDef } from "../layout";
import { STATUS_COLORS } from "./status";

/** A crew console: desk, holo screen facing the seat, status strip. */
export function Console({
  def,
  crew,
  active,
}: {
  def: ConsoleDef;
  crew?: CrewInfo;
  active: boolean;
}) {
  const { width, depth, height } = CONSOLE_SIZE;
  const glow = crew ? STATUS_COLORS[crew.status] : "#3d4a63";
  return (
    <group position={[def.x, 0, def.z]} rotation={[0, def.rotY, 0]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.1, height, depth]} />
        <meshToonMaterial color={active ? "#f1ead8" : "#c9ced9"} />
      </mesh>
      {/* Status strip along the crew-side edge. */}
      <mesh position={[0, height - 0.04, depth / 2 + 0.01]}>
        <boxGeometry args={[width - 0.3, 0.06, 0.02]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {/* Holo screen, tilted toward the seat. */}
      <group position={[0, height + 0.35, -0.15]} rotation={[-0.25, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.95, 0.6, 0.04]} />
          <meshToonMaterial color="#1b1e27" />
        </mesh>
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.86, 0.5]} />
          <meshBasicMaterial color={crew ? "#0b1d2a" : "#121620"} toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}
