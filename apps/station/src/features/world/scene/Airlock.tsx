import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh, MeshBasicMaterial, PointLight } from "three";
import { AIRLOCK } from "../layout";

/** The airlock's doors and lights, set each frame by whoever is going through it. */
export const airlock = { inner: 0, outer: 0, red: false, using: null as string | null };

const H = 2.5;
const W = AIRLOCK.halfWidth * 2;
const D = AIRLOCK.depth;
const HULL = "#c7ccd6";
const DOOR = "#8d96a8";

/** A chamber outside the east bulkhead: an inner door that rises, an outer hatch that parts. */
export function Airlock() {
  const inner = useRef<Mesh>(null);
  const outerL = useRef<Mesh>(null);
  const outerR = useRef<Mesh>(null);
  const lamp = useRef<PointLight>(null);
  const strip = useRef<Mesh>(null);
  const lights = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (inner.current) inner.current.position.y = H / 2 + airlock.inner * (H - 0.15);
    const part = airlock.outer * (W / 2);
    if (outerL.current) outerL.current.position.z = -W / 4 - part;
    if (outerR.current) outerR.current.position.z = W / 4 + part;
    const flash = airlock.red ? 0.6 + Math.abs(Math.sin(clock.elapsedTime * 6)) * 0.4 : 0;
    if (lamp.current) {
      lamp.current.intensity = airlock.red ? 6 * flash : 1.2;
      lamp.current.color.set(airlock.red ? "#ff2d3c" : "#cfe8ff");
    }
    if (strip.current) {
      (strip.current.material as MeshBasicMaterial).color.set(airlock.red ? "#ff2d3c" : "#3b4558");
    }
  });

  return (
    <group position={[AIRLOCK.x, 0, AIRLOCK.z]}>
      {/* Chamber shell: floor, roof and side walls, open at both ends for the doors. */}
      <mesh position={[D / 2, 0.02, 0]} receiveShadow>
        <boxGeometry args={[D, 0.04, W]} />
        <meshToonMaterial color="#2c313c" />
      </mesh>
      <mesh position={[D / 2, H + 0.1, 0]}>
        <boxGeometry args={[D, 0.2, W + 0.4]} />
        <meshToonMaterial color={HULL} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[D / 2, H / 2, side * (W / 2 + 0.1)]} castShadow>
          <boxGeometry args={[D, H, 0.2]} />
          <meshToonMaterial color={HULL} />
        </mesh>
      ))}
      {/* Hazard stripes round the inner door. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[-0.17, H / 2, side * (W / 2 + 0.08)]}>
          <boxGeometry args={[0.05, H, 0.16]} />
          <meshToonMaterial color="#ffb020" />
        </mesh>
      ))}
      <mesh ref={inner} position={[0, H / 2, 0]}>
        <boxGeometry args={[0.12, H, W]} />
        <meshToonMaterial color={DOOR} />
      </mesh>
      {/* Outer hatch: two halves sliding apart onto space. */}
      <mesh ref={outerL} position={[D, H / 2, -W / 4]}>
        <boxGeometry args={[0.12, H, W / 2]} />
        <meshToonMaterial color={DOOR} />
      </mesh>
      <mesh ref={outerR} position={[D, H / 2, W / 4]}>
        <boxGeometry args={[0.12, H, W / 2]} />
        <meshToonMaterial color={DOOR} />
      </mesh>
      <group ref={lights}>
        <mesh ref={strip} position={[-0.2, H + 0.05, 0]}>
          <boxGeometry args={[0.08, 0.12, W]} />
          <meshBasicMaterial color="#3b4558" toneMapped={false} />
        </mesh>
        <pointLight ref={lamp} position={[D / 2, H - 0.3, 0]} distance={6} intensity={1.2} />
      </group>
    </group>
  );
}
