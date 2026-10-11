import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color, Object3D, type InstancedMesh } from "three";

const COLORS = ["#ff5f1f", "#ffd166", "#06d6a0", "#5aa9ff", "#ef476f", "#f8f3e6"].map(
  (c) => new Color(c),
);

const dummy = new Object3D();

/**
 * A burst of confetti over a spot from `start` (ms), gone after `seconds`. Unlit pieces, made
 * once per burst; mount it keyed by `start` for a fresh one.
 */
export function Confetti({
  x,
  z,
  start,
  count,
  seconds,
  speed = 1,
}: {
  x: number;
  z: number;
  start: number;
  count: number;
  seconds: number;
  /** Scales how far and high the pieces fly. */
  speed?: number;
}) {
  const mesh = useRef<InstancedMesh>(null);
  // Each piece: its velocity and spin.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, () => {
        const a = Math.random() * Math.PI * 2;
        const v = (1.5 + Math.random() * 3) * speed;
        return {
          vx: Math.cos(a) * v,
          vy: (4 + Math.random() * 4) * speed,
          vz: Math.sin(a) * v,
          spin: Math.random() * 10,
        };
      }),
    [count, speed],
  );

  useEffect(() => {
    const c = mesh.current;
    if (!c) return;
    for (let i = 0; i < count; i++) c.setColorAt(i, COLORS[i % COLORS.length]!);
    if (c.instanceColor) c.instanceColor.needsUpdate = true;
  }, [count]);

  useFrame(() => {
    const c = mesh.current;
    if (!c) return;
    const t = (Date.now() - start) / 1000;
    c.visible = t < seconds;
    if (!c.visible) return;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      const y = 2.6 + p.vy * t - 4.9 * t * t * 0.35;
      dummy.position.set(x + p.vx * t * 0.6, Math.max(0.02, y), z + p.vz * t * 0.6);
      dummy.rotation.set(p.spin * t, p.spin * t * 0.7, 0);
      dummy.updateMatrix();
      c.setMatrixAt(i, dummy.matrix);
    }
    c.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <planeGeometry args={[0.07, 0.11]} />
      <meshBasicMaterial side={2} toneMapped={false} />
    </instancedMesh>
  );
}
