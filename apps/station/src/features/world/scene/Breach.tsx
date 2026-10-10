import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, Matrix4, type InstancedMesh, type MeshBasicMaterial } from "three";
import { GLOW, KIT } from "./materials";

const SPARKS = 24;
const LIFE = 4;
/** How long a breach shows; its parent unmounts it after this (useFor). */
export const BREACH_MS = LIFE * 1000;

/**
 * A hull breach at a console after a NO-GO: sparks flung up from the desk (one instanced mesh)
 * and a red emissive haze over it, for 4 s from `since`. No point light.
 */
export function Breach({ since }: { since: number }) {
  const sparks = useRef<InstancedMesh>(null);
  const haze = useRef<MeshBasicMaterial>(null);
  const seeds = useMemo(
    () =>
      Array.from({ length: SPARKS }, () => ({
        vx: (Math.random() - 0.5) * 0.9,
        vy: 0.8 + Math.random() * 1.4,
        vz: (Math.random() - 0.5) * 0.6,
        delay: Math.random() * 1.6,
      })),
    [since],
  );
  const color = useMemo(() => new Color(KIT.alarm).multiplyScalar(GLOW), []);
  const m = useMemo(() => new Matrix4(), []);

  useLayoutEffect(() => {
    for (let i = 0; i < SPARKS; i++) sparks.current?.setColorAt(i, color);
    if (sparks.current?.instanceColor) sparks.current.instanceColor.needsUpdate = true;
  }, [color]);

  useFrame(() => {
    const mesh = sparks.current;
    const age = (Date.now() - since) / 1000;
    if (!mesh) return;
    mesh.visible = age >= 0 && age < LIFE;
    if (!mesh.visible) return;
    seeds.forEach((s, i) => {
      const t = age - s.delay;
      if (t < 0 || t > 1.2) {
        mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        return;
      }
      const fade = 1 - t / 1.2;
      m.makeScale(fade, fade, fade).setPosition(s.vx * t, 0.9 + s.vy * t - 2.2 * t * t, s.vz * t);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (haze.current) {
      haze.current.opacity =
        0.35 * Math.max(0, 1 - age / LIFE) * (0.75 + 0.25 * Math.sin(age * 14));
    }
  });

  if (!since || Date.now() - since > LIFE * 1000) return null;
  return (
    <group position={[0, 0, -0.1]}>
      <instancedMesh ref={sparks} args={[undefined, undefined, SPARKS]} frustumCulled={false}>
        <sphereGeometry args={[0.02, 6, 5]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </instancedMesh>
      <mesh position={[0, 1.3, 0.1]} rotation={[0, 0, 0]}>
        <planeGeometry args={[1.8, 1.6]} />
        <meshBasicMaterial
          ref={haze}
          color={color}
          transparent
          opacity={0.35}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
