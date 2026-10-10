import type { CrewInfo, PreflightInfo } from "@mothership/protocol";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  Color,
  LinearMipmapLinearFilter,
  Matrix4,
  SRGBColorSpace,
  type InstancedMesh,
} from "three";
import { getScreen, onScreen } from "../../../shared/realtime/screens";
import { CONSOLE_SIZE, type ConsoleDef } from "../layout";
import { isGo } from "../../preflight/poll";
import { Breach, BREACH_MS } from "./Breach";
import { useFor, usePreflightTurn } from "./useTurn";
import { Furniture } from "./Furniture";
import { GLOW, KIT, PAINTED } from "./materials";
import { KAYKIT_SCALE } from "./models";
import { Lamps } from "./Lamps";
import { paintPreflight, showsPreflightPanel } from "./paint-preflight";
import { paintScreen } from "./paint-screen";
import { STATUS_COLORS } from "./status";

/** table_medium_long is 3 × 1 × 2 units; squash its depth to the layout's console depth. */
const TABLE = { width: 3, height: 1, depth: 2 };
const DEPTH_SQUASH = CONSOLE_SIZE.depth / (TABLE.depth * KAYKIT_SCALE);
export const DESK_TOP = TABLE.height * KAYKIT_SCALE;

const SCREEN = { width: 0.86, height: 0.49, px: 1024 };

/** The console's screen: its crew member's live terminal (agent-office's laptop screen). */
function HoloScreen({
  crewId,
  placeholder,
  preflight,
  status,
}: {
  crewId?: string;
  placeholder: string;
  preflight?: PreflightInfo;
  status?: CrewInfo["status"];
}) {
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

  const panel = showsPreflightPanel(preflight, status);
  const shownAt = useRef(0);
  if (!panel) shownAt.current = 0;
  else if (!shownAt.current) shownAt.current = Date.now();

  useEffect(() => {
    const { canvas, ctx, texture } = screen;
    if (panel && preflight) {
      // Elapsed time is counted from when the panel appeared: PreflightInfo has no start time.
      const since = shownAt.current;
      const paint = () => {
        paintPreflight(ctx, canvas.width, canvas.height, preflight, (Date.now() - since) / 1000);
        texture.needsUpdate = true;
      };
      paint();
      const tick = preflight.state === "running" ? setInterval(paint, 1000) : undefined;
      return () => clearInterval(tick);
    }
    const paint = () => {
      const frame = crewId ? getScreen(crewId)?.frame : undefined;
      paintScreen(ctx, canvas.width, canvas.height, frame, placeholder);
      texture.needsUpdate = true;
    };
    paint();
    return crewId ? onScreen(crewId, paint) : undefined;
  }, [screen, crewId, placeholder, panel, preflight]);

  useEffect(() => () => screen.texture.dispose(), [screen]);

  return (
    <mesh position={[0, 0, 0.019]}>
      <planeGeometry args={[SCREEN.width, SCREEN.height]} />
      {/* Lit by its own light, a little over 1 so the brightest text blooms softly. */}
      <meshStandardMaterial
        color="#000000"
        emissive="#ffffff"
        emissiveMap={screen.texture}
        emissiveIntensity={1.15}
        roughness={0.3}
      />
    </mesh>
  );
}

/**
 * How far the chair stands from the console's middle, on the crew side: its seat's front edge
 * tucks just under the desk, so a seated crew member's typing hands land on the keyboard.
 */
export const CHAIR_Z = 0.75;

/** Where the keyboard sits: its near edge at the desk's edge, under the typing hands (z ≈ 0.5). */
const KEYBOARD_Z = 0.44;

/** Key caps: 4 rows of 12, then the space bar; the bottom row is darker. */
const KEYS: { x: number; z: number; width: number; dark: boolean }[] = [
  ...Array.from({ length: 48 }, (_, i) => {
    const row = Math.floor(i / 12);
    return { x: -0.2 + (i % 12) * 0.0365, z: -0.045 + row * 0.03, width: 0.028, dark: row === 3 };
  }),
  { x: 0, z: 0.075, width: 0.2, dark: false },
];

/** Every key cap as one instanced mesh (one draw call per keyboard). */
function KeyCaps() {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const light = new Color("#d6dae6");
    const dark = new Color("#4a5263");
    KEYS.forEach((k, i) => {
      mesh.setMatrixAt(i, m.makeScale(k.width, 1, 1).setPosition(k.x, 0.019, k.z));
      mesh.setColorAt(i, k.dark ? dark : light);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, KEYS.length]}>
      <boxGeometry args={[1, 0.008, 0.022]} />
      <meshStandardMaterial roughness={0.5} />
    </instancedMesh>
  );
}

/** A keyboard and mouse at the crew-side edge of the desk, where typing hands land. */
function Keyboard({ glow }: { glow: string }) {
  return (
    <group position={[0, DESK_TOP, KEYBOARD_Z]}>
      <RoundedBox args={[0.48, 0.016, 0.15]} radius={0.006} position={[0, 0.008, 0]} castShadow>
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </RoundedBox>
      <KeyCaps />
      {/* A light strip along the back in the console's status colour. */}
      <mesh position={[0, 0.012, -0.07]}>
        <boxGeometry args={[0.46, 0.006, 0.008]} />
        <meshStandardMaterial
          color={glow}
          emissive={glow}
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
      <RoundedBox
        args={[0.06, 0.026, 0.1]}
        radius={0.012}
        position={[0.36, 0.013, 0.02]}
        castShadow
      >
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </RoundedBox>
    </group>
  );
}

/** A crew console: a KayKit desk and chair, a monitor showing the live terminal, and a status strip. */
export function Console({
  def,
  crew,
  active,
}: {
  def: ConsoleDef;
  crew?: CrewInfo;
  active: boolean;
}) {
  const nogoAt = usePreflightTurn(crew?.preflight, "nogo");
  const breaching = useFor(nogoAt, BREACH_MS);
  const glow = crew ? STATUS_COLORS[crew.status] : active ? KIT.orange : "#3d4a63";
  return (
    <group position={[def.x, 0, def.z]} rotation={[0, def.rotY, 0]}>
      <Furniture name="table_medium_long" position={[0, 0, 0]} scale={[1, 1, DEPTH_SQUASH]} />
      {/* chair_A faces +z (its back is on -z): turned round to face the desk. */}
      <Furniture name="chair_A" position={[0, 0, CHAIR_Z]} rotation={Math.PI} />
      <Keyboard glow={glow} />

      {/* Status strip along the crew-side edge of the desk. */}
      <mesh position={[0, DESK_TOP - 0.03, CONSOLE_SIZE.depth / 2 - 0.02]}>
        <boxGeometry args={[1.6, 0.03, 0.02]} />
        <meshStandardMaterial
          color={glow}
          emissive={glow}
          emissiveIntensity={crew?.status === "needs_input" ? GLOW : 1.2}
          toneMapped={false}
        />
      </mesh>
      {/* GO: a green rim around the desk's front edge, emissive like the status strip. */}
      {isGo(crew?.preflight) && (
        <mesh position={[0, DESK_TOP + 0.004, CONSOLE_SIZE.depth / 2 - 0.005]}>
          <boxGeometry args={[2.9, 0.012, 0.012]} />
          <meshStandardMaterial
            color="#3ddc84"
            emissive="#3ddc84"
            emissiveIntensity={GLOW}
            toneMapped={false}
          />
        </mesh>
      )}
      {breaching && <Breach since={nogoAt} />}
      {/* Pre-flight lamps, just above the status strip. */}
      <Lamps preflight={crew?.preflight} y={DESK_TOP - 0.005} />
      {/* Monitor: a foot on the desk, a neck, and the screen tilted toward the seat. */}
      <group position={[0, DESK_TOP, -0.22]}>
        <RoundedBox args={[0.3, 0.014, 0.18]} radius={0.006} position={[0, 0.007, 0]} castShadow>
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </RoundedBox>
        <mesh position={[0, 0.14, -0.02]} castShadow>
          <boxGeometry args={[0.06, 0.26, 0.03]} />
          <meshStandardMaterial color={KIT.slate} {...PAINTED} />
        </mesh>
      </group>
      <group position={[0, DESK_TOP + 0.36, -0.2]} rotation={[-0.2, 0, 0]}>
        <RoundedBox args={[0.95, 0.58, 0.035]} radius={0.015} castShadow>
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </RoundedBox>
        <HoloScreen
          crewId={crew?.id}
          preflight={crew?.preflight}
          status={crew?.status}
          placeholder={!crew ? "STANDBY" : crew.status === "asleep" ? "OFFLINE" : "BOOTING…"}
        />
      </group>
    </group>
  );
}
