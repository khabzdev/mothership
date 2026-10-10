import type { PreflightInfo } from "@mothership/protocol";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useRef } from "react";
import { Color, Matrix4, type InstancedMesh } from "three";
import { CONSOLE_SIZE } from "../layout";
import { GLOW, KIT } from "./materials";
import { lampStates, type LampState } from "./paint-preflight";

/** Lamp slots along the desk edge; a deck rarely has more checks than this. */
export const LAMP_SLOTS = 8;
const SPACING = 0.075;

// Lit lamps are boosted past 1 (GLOW) so they bloom; the material is unlit and untone-mapped.
const COLORS: Record<LampState, Color> = {
  off: new Color(KIT.charcoal),
  running: new Color(KIT.amber).multiplyScalar(GLOW),
  go: new Color("#3ddc84").multiplyScalar(GLOW),
  nogo: new Color(KIT.alarm).multiplyScalar(GLOW),
};

/**
 * Pre-flight lamps along the crew-side edge, just above the status strip: one instanced mesh.
 * An instance colour is a HDR value for lit lamps (above 1, via GLOW) and plain charcoal when off.
 */
export function Lamps({ preflight, y }: { preflight?: PreflightInfo; y: number }) {
  const ref = useRef<InstancedMesh>(null);
  const states = lampStates(preflight, LAMP_SLOTS);
  const statesRef = useRef(states);
  statesRef.current = states;
  const key = states.join();

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    const shown = Math.max(1, preflight?.checks.length ?? 0);
    states.forEach((state, i) => {
      // Slots past the checks are hidden by scaling to nothing.
      const x = (i - (shown - 1) / 2) * SPACING;
      m.makeScale(i < shown ? 1 : 0, i < shown ? 1 : 0, i < shown ? 1 : 0).setPosition(x, 0, 0);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.copy(COLORS[state]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, preflight?.checks.length]);

  // Running amber pulses by scaling its instance colour; the HDR colour does the glow.
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh || !statesRef.current.includes("running")) return;
    const pulse = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 5);
    const c = new Color();
    statesRef.current.forEach((state, i) => {
      if (state !== "running") return;
      mesh.setColorAt(i, c.copy(COLORS.running).multiplyScalar(pulse));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, LAMP_SLOTS]}
      position={[0, y, CONSOLE_SIZE.depth / 2 - 0.02]}
      frustumCulled={false}
    >
      <sphereGeometry args={[0.025, 10, 8]} />
      <meshBasicMaterial color="#ffffff" toneMapped={false} />
    </instancedMesh>
  );
}
