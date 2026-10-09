import { useRef } from "react";
import type { Object3D } from "three";
import { KAYKIT_SCALE, useFurniture } from "./models";
import { useSolid } from "./solid";

/** A KayKit furniture piece at a deck position, in the shared KayKit scale; `solid` blocks walking. */
export function Furniture({
  name,
  position,
  rotation = 0,
  scale = [1, 1, 1],
  solid = false,
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: [number, number, number];
  solid?: boolean;
}) {
  const scene = useFurniture(name);
  const ref = useRef<Object3D>(null);
  useSolid(ref, solid);
  return (
    <primitive
      ref={ref}
      object={scene}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale.map((v) => v * KAYKIT_SCALE) as [number, number, number]}
    />
  );
}
