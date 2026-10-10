import type { ConsoleLabel } from "@mothership/protocol";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { CanvasTexture, CylinderGeometry, SRGBColorSpace } from "three";
import { inkFor } from "../../labels/model";
import { CONSOLE_SIZE, type ConsoleDef } from "../layout";
import { KIT, PAINTED } from "./materials";

/** The sign sits above the monitors at the back of the desk, held by a mast from the floor. */
const BOARD = { w: 1.9, h: 0.46, y: 1.8 };

/** The mast is one thin pole from the floor beside the console up to the sign's edge. */
const MAST_GEOMETRY = new CylinderGeometry(0.03, 0.04, BOARD.y, 10);
const MAST_X = BOARD.w / 2 + 0.08;

/** The board's picture: rounded, in its colour, the text as big as it fits. */
function paint(canvas: HTMLCanvasElement, label: ConsoleLabel): void {
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  c.clearRect(0, 0, w, h);
  c.fillStyle = label.color;
  c.beginPath();
  c.roundRect(6, 6, w - 12, h - 12, 28);
  c.fill();
  c.lineWidth = 10;
  c.strokeStyle = "#0d0c0a";
  c.stroke();
  c.fillStyle = inkFor(label.color);
  c.textAlign = "center";
  c.textBaseline = "middle";
  let size = 150;
  const font = (px: number) => `800 ${px}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
  c.font = font(size);
  while (size > 40 && c.measureText(label.text.toUpperCase()).width > w - 90)
    c.font = font((size -= 6));
  c.fillText(label.text.toUpperCase(), w / 2, h / 2 + 6);
}

/**
 * agent-office's desk sign: on a mast beside the console, over the far edge of the console, facing its
 * chair. With no sign of its own on the console back to back, it says the same on the back too.
 */
export function Sign({
  def,
  label,
  twoSided,
}: {
  def: ConsoleDef;
  label: ConsoleLabel;
  twoSided: boolean;
}) {
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = Math.round((1024 * BOARD.h) / BOARD.w);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, []);

  useEffect(() => {
    const draw = () => {
      paint(canvas, label);
      texture.needsUpdate = true;
    };
    draw();
    // Repaint once the display font has loaded.
    void document.fonts?.load('800 64px "Big Shoulders Display"').then(draw, () => {});
  }, [canvas, texture, label]);

  useEffect(() => () => texture.dispose(), [texture]);

  const z = -CONSOLE_SIZE.depth / 2;
  return (
    <group position={[def.x, 0, def.z]} rotation={[0, def.rotY, 0]}>
      <group position={[0, BOARD.y, z]}>
        <mesh position={[0, 0, 0.014]}>
          <planeGeometry args={[BOARD.w, BOARD.h]} />
          <meshStandardMaterial
            map={texture}
            transparent
            emissive="#ffffff"
            emissiveMap={texture}
            emissiveIntensity={0.35}
            roughness={0.5}
          />
        </mesh>
        {twoSided && (
          <mesh position={[0, 0, -0.014]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[BOARD.w, BOARD.h]} />
            <meshStandardMaterial
              map={texture}
              transparent
              emissive="#ffffff"
              emissiveMap={texture}
              emissiveIntensity={0.35}
              roughness={0.5}
            />
          </mesh>
        )}
        <RoundedBox args={[BOARD.w - 0.06, BOARD.h - 0.06, 0.024]} radius={0.01} castShadow>
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </RoundedBox>
      </group>
      <mesh geometry={MAST_GEOMETRY} position={[MAST_X, BOARD.y / 2, z]} castShadow>
        <meshStandardMaterial color={KIT.slate} {...PAINTED} />
      </mesh>
    </group>
  );
}
