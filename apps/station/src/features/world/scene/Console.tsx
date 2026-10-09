import type { CrewInfo } from "@mothership/protocol";
import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { getScreen, onScreen } from "../../../shared/realtime/screens";
import { CONSOLE_SIZE, type ConsoleDef } from "../layout";
import { Furniture } from "./Furniture";
import { KAYKIT_SCALE } from "./models";
import { paintScreen } from "./paint-screen";
import { STATUS_COLORS } from "./status";

/** table_medium_long is 3 × 1 × 2 units; squash its depth to the layout's console depth. */
const TABLE = { width: 3, height: 1, depth: 2 };
const DEPTH_SQUASH = CONSOLE_SIZE.depth / (TABLE.depth * KAYKIT_SCALE);
export const DESK_TOP = TABLE.height * KAYKIT_SCALE;

const SCREEN = { width: 0.86, height: 0.49, px: 1024 };

/** The console's screen: its crew member's live terminal (agent-office's laptop screen). */
function HoloScreen({ crewId, placeholder }: { crewId?: string; placeholder: string }) {
  const screen = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = SCREEN.px;
    canvas.height = Math.round((SCREEN.px * SCREEN.height) / SCREEN.width);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = LinearMipmapLinearFilter;
    return { canvas, ctx: canvas.getContext("2d")!, texture };
  }, []);

  useEffect(() => {
    const { canvas, ctx, texture } = screen;
    const paint = () => {
      const frame = crewId ? getScreen(crewId)?.frame : undefined;
      paintScreen(ctx, canvas.width, canvas.height, frame, placeholder);
      texture.needsUpdate = true;
    };
    paint();
    return crewId ? onScreen(crewId, paint) : undefined;
  }, [screen, crewId, placeholder]);

  useEffect(() => () => screen.texture.dispose(), [screen]);

  return (
    <mesh position={[0, 0, 0.025]}>
      <planeGeometry args={[SCREEN.width, SCREEN.height]} />
      <meshBasicMaterial map={screen.texture} toneMapped={false} />
    </mesh>
  );
}

/** A crew console: a KayKit desk and chair with a holo screen and a status strip. */
export function Console({
  def,
  crew,
  active,
}: {
  def: ConsoleDef;
  crew?: CrewInfo;
  active: boolean;
}) {
  const glow = crew ? STATUS_COLORS[crew.status] : active ? "#ff5f1f" : "#3d4a63";
  return (
    <group position={[def.x, 0, def.z]} rotation={[0, def.rotY, 0]}>
      <Furniture name="table_medium_long" position={[0, 0, 0]} scale={[1, 1, DEPTH_SQUASH]} />
      {/* The chair sits on the crew side, facing the desk. */}
      <Furniture name="chair_A" position={[0, 0, 0.85]} />

      {/* Status strip along the crew-side edge of the desk. */}
      <mesh position={[0, DESK_TOP - 0.03, CONSOLE_SIZE.depth / 2 - 0.02]}>
        <boxGeometry args={[1.6, 0.04, 0.03]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {/* Holo screen, tilted toward the seat. */}
      <group position={[0, DESK_TOP + 0.34, -0.2]} rotation={[-0.2, 0, 0]}>
        <mesh>
          <boxGeometry args={[0.95, 0.58, 0.04]} />
          <meshToonMaterial color="#20242e" />
        </mesh>
        <HoloScreen
          crewId={crew?.id}
          placeholder={!crew ? "STANDBY" : crew.status === "asleep" ? "OFFLINE" : "BOOTING…"}
        />
        <mesh position={[0, -0.36, -0.02]}>
          <boxGeometry args={[0.08, 0.16, 0.06]} />
          <meshToonMaterial color="#20242e" />
        </mesh>
      </group>
    </group>
  );
}
