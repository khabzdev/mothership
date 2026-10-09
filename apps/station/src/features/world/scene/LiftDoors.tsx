import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, SRGBColorSpace, type Mesh } from "three";
import { LIFT } from "../layout";
import type { DeckPaint } from "../paint";
import { captain } from "./Captain";

const H = 2.5;
const DOOR = LIFT.width / 2;

/** The deck's name plate over the lift, in its trim colour. */
function usePlate(deckName: string, trim: string) {
  const plate = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { canvas, texture };
  }, []);
  useEffect(() => {
    const draw = () => {
      const c = plate.canvas.getContext("2d")!;
      c.fillStyle = "#14130f";
      c.fillRect(0, 0, 512, 128);
      c.fillStyle = trim;
      c.fillRect(0, 118, 512, 10);
      c.font = '800 70px "Big Shoulders Display", "Arial Narrow", sans-serif';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = "#ece6d6";
      let text = `▲▼ ${deckName.toUpperCase()}`;
      while (c.measureText(text).width > 480 && text.length > 6) text = `${text.slice(0, -2)}…`;
      c.fillText(text, 256, 62);
      plate.texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.load('800 64px "Big Shoulders Display"').then(draw, () => {});
  }, [plate, deckName, trim]);
  useEffect(() => () => plate.texture.dispose(), [plate]);
  return plate.texture;
}

/** The lift in the north bulkhead: its doors slide open as you walk up (agent-office's elevator). */
export function LiftDoors({ deckName, paint }: { deckName: string; paint: DeckPaint }) {
  const left = useRef<Mesh>(null);
  const right = useRef<Mesh>(null);
  const open = useRef(0);
  const plate = usePlate(deckName, paint.trim);

  useFrame((_, delta) => {
    const near = Math.hypot(captain.x - LIFT.x, captain.z - LIFT.z) < 3.4;
    open.current += ((near ? 1 : 0) - open.current) * Math.min(1, delta * 5);
    const slide = open.current * (DOOR - 0.08);
    if (left.current) left.current.position.x = -DOOR / 2 - slide;
    if (right.current) right.current.position.x = DOOR / 2 + slide;
  });

  return (
    <group position={[LIFT.x, 0, LIFT.z + 0.16]}>
      {/* The car behind the doors. */}
      <mesh position={[0, H / 2, -0.05]}>
        <planeGeometry args={[LIFT.width, H]} />
        <meshToonMaterial color="#1a1d24" />
      </mesh>
      <mesh ref={left} position={[-DOOR / 2, H / 2, 0.03]}>
        <boxGeometry args={[DOOR, H, 0.05]} />
        <meshToonMaterial color="#aab3c2" />
      </mesh>
      <mesh ref={right} position={[DOOR / 2, H / 2, 0.03]}>
        <boxGeometry args={[DOOR, H, 0.05]} />
        <meshToonMaterial color="#aab3c2" />
      </mesh>
      {/* Frame in the deck's trim colour. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (LIFT.width / 2 + 0.12), H / 2, 0.06]}>
          <boxGeometry args={[0.24, H + 0.1, 0.16]} />
          <meshToonMaterial color={paint.trim} />
        </mesh>
      ))}
      <mesh position={[0, H + 0.18, 0.06]}>
        <boxGeometry args={[LIFT.width + 0.48, 0.36, 0.16]} />
        <meshToonMaterial color={paint.trim} />
      </mesh>
      <mesh position={[0, H + 0.18, 0.15]}>
        <planeGeometry args={[LIFT.width + 0.2, 0.3]} />
        <meshBasicMaterial map={plate} toneMapped={false} />
      </mesh>
      {/* Call button. */}
      <mesh position={[LIFT.width / 2 + 0.45, 1.15, 0.05]}>
        <boxGeometry args={[0.18, 0.3, 0.05]} />
        <meshToonMaterial color="#20242e" />
      </mesh>
      <mesh position={[LIFT.width / 2 + 0.45, 1.15, 0.08]}>
        <circleGeometry args={[0.05, 16]} />
        <meshBasicMaterial color={paint.trim} toneMapped={false} />
      </mesh>
    </group>
  );
}
