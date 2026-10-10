import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import type { Group } from "three";
import { KIT, PAINTED } from "./materials";

const THICK = 0.06;

/** Bulkhead height (m) of the airlock's door frame. */
export const WALL_H = 3.2;
/** A door module's width (m): its opening is 0.6 of it, 1.8 m, the airlock's width. */
export const DOOR_MODULE = 3;
/** The door frame's opening, as a share of the module's width and height. */
export const DOOR_OPENING = { width: 0.6, height: 0.695 } as const;

/** One leaf: a rounded panel, an orange edge where the two leaves meet, and a narrow window. */
function Leaf({ width, height, side }: { width: number; height: number; side: -1 | 1 }) {
  const edge = -side * (width / 2 - 0.03);
  return (
    <group>
      <RoundedBox
        args={[width, height, THICK]}
        radius={0.02}
        smoothness={3}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={KIT.hull} {...PAINTED} />
      </RoundedBox>
      <mesh position={[edge, 0, 0]}>
        <boxGeometry args={[0.05, height - 0.06, THICK + 0.01]} />
        <meshStandardMaterial color={KIT.orange} {...PAINTED} />
      </mesh>
      <mesh position={[edge + side * 0.22, height * 0.16, 0]}>
        <boxGeometry args={[0.1, height * 0.36, THICK + 0.008]} />
        <meshStandardMaterial color="#1c2230" roughness={0.15} metalness={0.4} />
      </mesh>
    </group>
  );
}

/**
 * A pair of doors that part sideways into pockets in the wall (an opening `width` wide). The doors
 * run along x in their own frame; `open` (0 shut … 1 open) is read every frame and eased.
 */
export function SlidingDoors({
  width,
  height,
  open,
  onOpening,
}: {
  width: number;
  height: number;
  open: MutableRefObject<number>;
  /** Called once as the doors start to part. */
  onOpening?: () => void;
}) {
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const shown = useRef(0);
  const half = width / 2;

  useFrame((_, delta) => {
    const was = shown.current;
    // Ease toward the target (critically damped feel, no overshoot).
    shown.current += (open.current - shown.current) * Math.min(1, delta * 6);
    if (was < 0.02 && shown.current >= 0.02) onOpening?.();
    // Each leaf slides its own width, all the way into the wall.
    const slide = shown.current * (half - 0.02);
    if (left.current) left.current.position.x = -half / 2 - slide;
    if (right.current) right.current.position.x = half / 2 + slide;
  });

  return (
    <group>
      <group ref={left} position={[-half / 2, height / 2, 0]}>
        <Leaf width={half} height={height} side={-1} />
      </group>
      <group ref={right} position={[half / 2, height / 2, 0]}>
        <Leaf width={half} height={height} side={1} />
      </group>
    </group>
  );
}
