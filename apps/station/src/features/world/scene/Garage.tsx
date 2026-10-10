import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import type { Mesh } from "three";
import { GARAGE } from "../outpost";
import { useProp } from "./models";

/** The garage door, set each frame by whoever is going through it, and who's waiting their turn. */
export const garage = { door: 0, using: null as string | null, queue: [] as string[] };

/** How much of the door is left showing, rolled up under the roof, when it's fully open. */
const ROLLED = 0.05;

/**
 * The garage on the outpost's south row, drawn on its own copy so its door can move: the door
 * rolls up into the module (shrinking towards its top edge while it rises about its own height)
 * for crew sent home.
 */
export function Garage() {
  const scene = useProp("basemodule_garage");
  const door = useMemo(() => {
    const node = scene.getObjectByName("basemodule_garage_door") as Mesh | undefined;
    if (!node) throw new Error("No door in basemodule_garage");
    node.geometry.computeBoundingBox();
    return { node, top: node.geometry.boundingBox!.max.y };
  }, [scene]);

  useFrame(() => {
    const rolled = 1 - (1 - ROLLED) * garage.door;
    door.node.scale.y = rolled;
    door.node.position.y = door.top * (1 - rolled);
  });

  return (
    <primitive
      object={scene}
      position={GARAGE.position}
      rotation={[0, GARAGE.rotY, 0]}
      scale={GARAGE.scale}
    />
  );
}
