import type { ConsoleLabel } from "@mothership/protocol";
import { RoundedBox } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { inkFor } from "../../labels/model";
import { CONSOLE_SIZE, type ConsoleDef } from "../layout";
import { DESK_TOP } from "./Console";
import { KIT, PAINTED } from "./materials";

/** The sign stands on two posts at the back of the desk, above the monitors. */
const BOARD = { w: 1.9, h: 0.46, y: 1.8 };

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
 * agent-office's desk sign: hung from the deckhead over the far edge of the console, facing its
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
  const post = BOARD.y - BOARD.h / 2 - DESK_TOP;
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
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * (BOARD.w / 2 - 0.15), -BOARD.h / 2 - post / 2, 0]}
            castShadow
          >
            <cylinderGeometry args={[0.015, 0.015, post, 10]} />
            <meshStandardMaterial color={KIT.slate} {...PAINTED} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
