import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import type { Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const CHARACTER_URL = (name: string) => `/models/crew/${name}.glb`;
const PROP_URL = (name: string) => `/models/space-base/${name}.gltf`;

/** Body parts we keep: weapons, shields, hats and capes are fantasy gear, not spacewear. */
const BODY = /_(Body|Head|Head_Hooded|ArmLeft|ArmRight|LegLeft|LegRight)$/;

/** A KayKit character with its own skeleton (safe to animate independently) and its clips. */
export function useCharacter(name: string) {
  const gltf = useGLTF(CHARACTER_URL(name));
  const scene = useMemo(() => {
    const copy = clone(gltf.scene);
    copy.traverse((node: Object3D) => {
      if ((node as { isMesh?: boolean }).isMesh) {
        node.visible = BODY.test(node.name);
        node.castShadow = true;
      }
    });
    return copy;
  }, [gltf.scene]);
  return { scene, animations: gltf.animations };
}

/** A static KayKit Space Base prop. */
export function useProp(name: string) {
  const gltf = useGLTF(PROP_URL(name));
  return useMemo(() => {
    const copy = gltf.scene.clone();
    copy.traverse((node: Object3D) => {
      node.castShadow = true;
      node.receiveShadow = true;
    });
    return copy;
  }, [gltf.scene]);
}

for (const name of ["Knight", "Barbarian", "Mage", "Rogue", "Rogue_Hooded"])
  useGLTF.preload(CHARACTER_URL(name));
