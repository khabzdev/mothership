import { useGLTF } from "@react-three/drei";
import { useMemo } from "react";
import type { Object3D } from "three";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";

const CHARACTER_URL = (name: string) => `/models/crew/${name}.glb`;
const PROP_URL = (name: string) => `/models/space-base/${name}.gltf`;
const FURNITURE_URL = (name: string) => `/models/furniture/${name}.gltf`;

/** One scale for every KayKit model, so characters and furniture stay in proportion (crew ≈ 1.6 m). */
export const KAYKIT_SCALE = 0.7;

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
  return useStatic(PROP_URL(name));
}

/** A static KayKit Furniture Bits piece. */
export function useFurniture(name: string) {
  return useStatic(FURNITURE_URL(name));
}

function useStatic(url: string) {
  const gltf = useGLTF(url);
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
