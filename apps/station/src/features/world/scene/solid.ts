import { useLayoutEffect, type RefObject } from "react";
import { Box3, type Object3D } from "three";
import { addCollider } from "../layout";

const box = new Box3();

/** Make a placed piece solid: its floor footprint (world bounding box) blocks the Captain. */
export function useSolid(ref: RefObject<Object3D | null>, solid: boolean): void {
  useLayoutEffect(() => {
    const object = ref.current;
    if (!solid || !object) return;
    object.updateWorldMatrix(true, true);
    box.setFromObject(object);
    // A little inside the outline, so you can brush past corners.
    return addCollider({
      minX: box.min.x + 0.05,
      maxX: box.max.x - 0.05,
      minZ: box.min.z + 0.05,
      maxZ: box.max.z - 0.05,
    });
  }, [ref, solid]);
}
