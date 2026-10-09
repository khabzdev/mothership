import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace, type MeshStandardMaterial } from "three";
import { DOOR_MODULE, DOOR_OPENING, WALL_H } from "../bulkheads";
import { LIFT } from "../layout";
import type { DeckPaint } from "../paint";
import { playLiftChime } from "../sound";
import { captain } from "./Captain";
import { GLOW, KIT, PAINTED } from "./materials";
import { SlidingDoors } from "./SlidingDoors";

/** The doorway in the Kenney door frame. */
const OPEN_W = DOOR_MODULE * DOOR_OPENING.width;
const OPEN_H = WALL_H * DOOR_OPENING.height;
/** Bulkhead faces: the deck side and the back, where the car is. */
const FACE = 0.15;
/** The car behind the wall. */
const CAR = { width: OPEN_W + 0.3, depth: 1.8, height: OPEN_H + 0.25 };
/** How close you walk before the doors open. */
const NEAR = 3.4;

/** The deck's name plate over the lift: light text on a dark display, glowing a little. */
function usePlate(deckName: string, trim: string) {
  const plate = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, []);
  useEffect(() => {
    const draw = () => {
      const c = plate.canvas.getContext("2d")!;
      c.fillStyle = "#101114";
      c.fillRect(0, 0, 512, 128);
      c.fillStyle = trim;
      c.fillRect(24, 100, 464, 4);
      c.font = '600 54px "Instrument Sans", system-ui, sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#ece6d6";
      let text = `▲▼  ${deckName}`;
      while (c.measureText(text).width > 460 && text.length > 6) text = `${text.slice(0, -2)}…`;
      c.fillText(text, 256, 56);
      plate.texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.load('600 54px "Instrument Sans"').then(draw, () => {});
  }, [plate, deckName, trim]);
  useEffect(() => () => plate.texture.dispose(), [plate]);
  return plate.texture;
}

/** The lift car behind the north bulkhead: lit, panelled, with a handrail, seen when the doors part. */
function Car({ open }: { open: { current: number } }) {
  const panel = useRef<MeshStandardMaterial>(null);
  useFrame(() => {
    // The car lights up as the doors open, so a shut lift isn't glowing through its seams.
    const on = 0.25 + open.current * 0.75;
    if (panel.current) panel.current.emissiveIntensity = GLOW * on;
  });
  const z0 = -FACE - CAR.depth / 2;
  return (
    <group position={[0, 0, z0]}>
      <mesh position={[0, -0.02, 0]} receiveShadow>
        <boxGeometry args={[CAR.width, 0.04, CAR.depth]} />
        <meshStandardMaterial color={KIT.charcoal} roughness={0.8} />
      </mesh>
      <mesh position={[0, CAR.height / 2, -CAR.depth / 2]} receiveShadow>
        <boxGeometry args={[CAR.width, CAR.height, 0.06]} />
        <meshStandardMaterial color={KIT.slate} {...PAINTED} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * CAR.width) / 2, CAR.height / 2, 0]} receiveShadow>
          <boxGeometry args={[0.06, CAR.height, CAR.depth]} />
          <meshStandardMaterial color={KIT.slate} {...PAINTED} />
        </mesh>
      ))}
      <mesh position={[0, CAR.height, 0]}>
        <boxGeometry args={[CAR.width, 0.06, CAR.depth]} />
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </mesh>
      <mesh position={[0, CAR.height - 0.04, 0]}>
        <boxGeometry args={[CAR.width * 0.6, 0.02, CAR.depth * 0.6]} />
        <meshStandardMaterial
          ref={panel}
          color={KIT.ice}
          emissive={KIT.ice}
          emissiveIntensity={GLOW}
          toneMapped={false}
        />
      </mesh>
      {/* Handrail along the back wall. */}
      <mesh position={[0, 0.95, -CAR.depth / 2 + 0.08]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.025, 0.025, CAR.width - 0.3, 12]} />
        <meshStandardMaterial color={KIT.orange} {...PAINTED} />
      </mesh>
    </group>
  );
}

/** The lift in the north bulkhead: its doors part into the wall as you walk up (agent-office's elevator). */
export function LiftDoors({ deckName, paint }: { deckName: string; paint: DeckPaint }) {
  const open = useRef(0);
  const button = useRef<MeshStandardMaterial>(null);
  const plate = usePlate(deckName, paint.trim);

  useFrame(() => {
    const near = Math.hypot(captain.x - LIFT.x, captain.z - LIFT.z) < NEAR;
    open.current = near ? 1 : 0;
    if (button.current) button.current.emissiveIntensity = near ? GLOW : 0.6;
  });

  return (
    <group position={[LIFT.x, 0, LIFT.z]}>
      <Car open={open} />
      <SlidingDoors width={OPEN_W} height={OPEN_H} open={open} onOpening={playLiftChime} />
      {/* Name plate above the frame. */}
      <group position={[0, OPEN_H + 0.5, FACE + 0.02]}>
        <mesh>
          <boxGeometry args={[OPEN_W + 0.1, 0.5, 0.04]} />
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </mesh>
        <mesh position={[0, 0, 0.021]}>
          <planeGeometry args={[OPEN_W, 0.45]} />
          <meshStandardMaterial
            map={plate}
            emissiveMap={plate}
            emissive="#ffffff"
            emissiveIntensity={0.9}
            roughness={0.4}
          />
        </mesh>
      </group>
      {/* Call panel beside the frame. */}
      <group position={[OPEN_W / 2 + 0.55, 1.2, FACE + 0.02]}>
        <mesh>
          <boxGeometry args={[0.16, 0.28, 0.04]} />
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </mesh>
        <mesh position={[0, 0.03, 0.025]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.035, 0.015, 20]} />
          <meshStandardMaterial
            ref={button}
            color={paint.trim}
            emissive={paint.trim}
            emissiveIntensity={0.6}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
