import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
} from "three";
import { captain } from "./Captain";

// agent-office's needs-you beacon: a red pin with a "!" over the crew member's tag, a pillar of light
// you can see from across the deck, and rings spreading over the floor. It thins out as you walk up.

const RED = "#ef476f";
const INK = "#2b2d42";
const LIGHT = "#ff2d5f";
const BEAM_HEIGHT = 5.6;
const PIN = { w: 0.5, h: 0.645, full: 6, most: 3 };
const RINGS = { n: 2, from: 0.6, to: 2.3, every: 2 };
/** How close (m) the light is gone altogether, and how far off it's at its brightest. */
const NEAR = 3;
const FAR = 6.5;

let pinTexture: CanvasTexture | undefined;
let beamTexture: CanvasTexture | undefined;
let beamShape: CylinderGeometry | undefined;
let ringShape: RingGeometry | undefined;

/** A red drop, point down, inked round, with a white "!". */
function pinPicture(): CanvasTexture {
  if (pinTexture) return pinTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 248;
  canvas.height = 320;
  const c = canvas.getContext("2d")!;
  const [cx, cy, r] = [124, 112, 100];
  c.beginPath();
  c.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 0.18);
  c.lineTo(cx, 308);
  c.closePath();
  c.fillStyle = RED;
  c.fill();
  c.lineWidth = 14;
  c.lineJoin = "round";
  c.strokeStyle = INK;
  c.stroke();
  c.fillStyle = "#ffffff";
  c.font = "900 150px system-ui, sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("!", cx, cy + 8);
  pinTexture = new CanvasTexture(canvas);
  pinTexture.colorSpace = SRGBColorSpace;
  return pinTexture;
}

/** Thin where the crew member and its screen are, strongest over its head, gone by the top. */
function beamPicture(): CanvasTexture {
  if (beamTexture) return beamTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 128;
  const c = canvas.getContext("2d")!;
  const fade = c.createLinearGradient(0, 128, 0, 0);
  fade.addColorStop(0, "rgba(255,255,255,0.5)");
  fade.addColorStop(0.3, "rgba(255,255,255,0.42)");
  fade.addColorStop(0.5, "rgba(255,255,255,1)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = fade;
  c.fillRect(0, 0, 4, 128);
  beamTexture = new CanvasTexture(canvas);
  beamTexture.colorSpace = SRGBColorSpace;
  return beamTexture;
}

/** The beacon over a crew member at (x, z) whose tag tops out at `top` m. */
export function Beacon({ x, z, top }: { x: number; z: number; top: number }) {
  const pin = useRef<Sprite>(null);
  const beam = useRef<Mesh>(null);
  const rings = useRef<(Mesh | null)[]>([]);
  const root = useRef<Group>(null);
  const shapes = useMemo(() => {
    beamShape ??= new CylinderGeometry(0.4, 0.55, 1, 24, 1, true).translate(0, 0.5, 0);
    ringShape ??= new RingGeometry(0.88, 1, 56).rotateX(-Math.PI / 2);
    return { beam: beamShape, ring: ringShape, pin: pinPicture(), light: beamPicture() };
  }, []);

  useFrame(({ clock, camera }) => {
    const t = clock.elapsedTime;
    const beat = Math.sin(t * 6.4);
    const away = Math.hypot(camera.position.x - x, camera.position.z - z);
    const d = Math.hypot(captain.x - x, captain.z - z);
    const near = 1 - Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
    if (pin.current) {
      const size = (1 + beat * 0.09) * Math.min(PIN.most, Math.max(1, away / PIN.full));
      pin.current.scale.set(PIN.w * size, PIN.h * size, 1);
      pin.current.position.y = top + 0.12 + Math.sin(t * 3.2) * 0.06;
    }
    if (beam.current) {
      const far = 1 - near;
      (beam.current.material as { opacity: number }).opacity = (0.64 + beat * 0.14) * far;
      beam.current.visible = far > 0.02;
    }
    rings.current.forEach((ring, i) => {
      if (!ring) return;
      const p = (t / RINGS.every + i / RINGS.n) % 1;
      ring.scale.setScalar(RINGS.from + (RINGS.to - RINGS.from) * p);
      (ring.material as { opacity: number }).opacity = (1 - p) ** 1.4 * 0.9 * (1 - near * 0.6);
    });
  });

  return (
    <group ref={root} position={[x, 0, z]}>
      <mesh ref={beam} geometry={shapes.beam} scale={[1, BEAM_HEIGHT, 1]} renderOrder={5}>
        <meshBasicMaterial
          color={LIGHT}
          map={shapes.light}
          transparent
          opacity={0}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {Array.from({ length: RINGS.n }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => void (rings.current[i] = m)}
          geometry={shapes.ring}
          position={[0, 0.03 + i * 0.004, 0]}
        >
          <meshBasicMaterial
            color={LIGHT}
            transparent
            opacity={0}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
      <sprite ref={pin} center={[0.5, 0]} renderOrder={10}>
        <spriteMaterial map={shapes.pin} transparent depthWrite={false} toneMapped={false} />
      </sprite>
    </group>
  );
}
