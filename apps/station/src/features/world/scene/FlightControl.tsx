import { RoundedBox } from "@react-three/drei";
import type { DeckCheck } from "@mothership/protocol";
import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { lessonsToReview } from "../../debrief/model";
import { FLIGHT_CONTROL, FLIGHT_CONTROL_DESK } from "../layout";
import { KIT, PAINTED } from "./materials";

const SCREEN = { width: 1.7, height: 0.72 } as const;
const PX = { width: 768, height: Math.round((768 * SCREEN.height) / SCREEN.width) } as const;
const MAX_ROWS = 4;

function paint(
  canvas: HTMLCanvasElement,
  armed: boolean | null,
  checks: DeckCheck[],
  lessonsPending: number,
) {
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  c.fillStyle = "#14171e";
  c.fillRect(0, 0, w, h);
  c.fillStyle = KIT.orange;
  c.fillRect(0, 0, w, 10);

  c.textBaseline = "middle";
  c.fillStyle = "#ece6d6";
  c.font = '800 50px "Big Shoulders Display", "Arial Narrow", sans-serif';
  c.fillText("FLIGHT CONTROL", 28, 56);

  c.textAlign = "right";
  c.font = '700 30px "Martian Mono", ui-monospace, monospace';
  c.fillStyle = armed ? "#7bd88f" : KIT.amber;
  c.fillText(armed ? "ARMED" : "NOT ARMED", w - 28, 58);
  c.textAlign = "left";

  // Lessons waiting at the Debrief (L), along the bottom on the right.
  if (lessonsPending > 0) {
    c.textAlign = "right";
    c.font = '600 26px "Martian Mono", ui-monospace, monospace';
    c.fillStyle = KIT.amber;
    c.fillText(lessonsToReview(lessonsPending), w - 28, h - 28);
    c.textAlign = "left";
  }

  c.font = '500 28px "Martian Mono", ui-monospace, monospace';
  if (!checks.length) {
    c.fillStyle = "#5e584b";
    c.fillText("No checks yet", 28, 140);
    return;
  }
  checks.slice(0, MAX_ROWS).forEach((check, i) => {
    const y = 128 + i * 44;
    c.fillStyle = check.enabled ? KIT.ice : "#5e584b";
    c.fillRect(32, y - 7, 14, 14);
    c.fillText(check.name, 62, y);
  });
  if (checks.length > MAX_ROWS) {
    c.fillStyle = "#9a9382";
    c.fillText(`+${checks.length - MAX_ROWS} more`, 62, 128 + MAX_ROWS * 44);
  }
}

/**
 * Flight Control: a desk against the deck's south edge, whose screen shows the deck's pre-flight
 * checks, whether they're armed and any lessons to review. E in front of it opens the Flight Control
 * window, L the Debrief.
 */
export function FlightControl({
  armed,
  checks,
  lessonsPending,
}: {
  armed: boolean | null;
  checks: DeckCheck[];
  lessonsPending: number;
}) {
  const surface = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = PX.width;
    canvas.height = PX.height;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, texture };
  }, []);

  useEffect(() => {
    const draw = () => {
      paint(surface.canvas, armed, checks, lessonsPending);
      surface.texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.ready.then(draw);
  }, [surface, armed, checks, lessonsPending]);
  useEffect(() => () => surface.texture.dispose(), [surface]);

  const { width, depth, height } = FLIGHT_CONTROL_DESK;
  // Back against the south edge, its front (and screen) facing into the deck (-z).
  const z = FLIGHT_CONTROL.z - 0.15 - depth / 2;

  return (
    <group position={[FLIGHT_CONTROL.x, 0, z]} rotation={[0, Math.PI, 0]}>
      {/* The desk: a slate body, a dark top and the kit's orange trim along its front. */}
      <mesh position={[0, (height - 0.06) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, height - 0.06, depth]} />
        <meshStandardMaterial color={KIT.slate} {...PAINTED} />
      </mesh>
      <RoundedBox
        args={[width + 0.06, 0.06, depth + 0.06]}
        radius={0.02}
        position={[0, height - 0.03, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </RoundedBox>
      <mesh position={[0, height - 0.12, depth / 2 + 0.005]}>
        <boxGeometry args={[width, 0.05, 0.01]} />
        <meshStandardMaterial color={KIT.orange} {...PAINTED} />
      </mesh>

      {/* The screen, framed and tilted back toward whoever stands at the desk. */}
      <group position={[0, height + 0.48, -depth / 2 + 0.2]} rotation={[-0.22, 0, 0]}>
        <RoundedBox
          args={[SCREEN.width + 0.1, SCREEN.height + 0.1, 0.06]}
          radius={0.025}
          castShadow
        >
          <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
        </RoundedBox>
        <mesh position={[0, 0, 0.031]}>
          <planeGeometry args={[SCREEN.width, SCREEN.height]} />
          <meshStandardMaterial
            color="#000000"
            emissive="#ffffff"
            emissiveMap={surface.texture}
            emissiveIntensity={0.9}
            roughness={0.5}
          />
        </mesh>
      </group>
      <mesh position={[0, height + 0.1, -depth / 2 + 0.16]}>
        <boxGeometry args={[0.12, 0.2, 0.08]} />
        <meshStandardMaterial color={KIT.charcoal} {...PAINTED} />
      </mesh>
    </group>
  );
}
