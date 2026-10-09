import { KAYKIT_SCALE, useFurniture } from "./models";

/** A KayKit furniture piece at a deck position, in the shared KayKit scale. */
export function Furniture({
  name,
  position,
  rotation = 0,
  scale = [1, 1, 1],
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: [number, number, number];
}) {
  const scene = useFurniture(name);
  return (
    <primitive
      object={scene}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale.map((v) => v * KAYKIT_SCALE) as [number, number, number]}
    />
  );
}
