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
        node.receiveShadow = true;
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

/** Every KayKit Space Base piece the app references, each preloaded. */
export const SPACE_PIECES: readonly string[] = [
  "basemodule_A",
  "basemodule_B",
  "basemodule_C",
  "basemodule_garage",
  "cargo_A",
  "cargo_A_stacked",
  "cargo_B",
  "containers_A",
  "containers_B",
  "drill_structure",
  "lander_A",
  "landingpad_large",
  "lights",
  "rock_A",
  "rocks_A",
  "solarpanel",
  "spacetruck",
  "structure_low",
  "structure_tall",
  "basemodule_D",
  "basemodule_E",
  "cargodepot_A",
  "rock_B",
  "rocks_B",
  "roofmodule_solarpanels",
  "spacetruck_trailer",
  "terrain_low",
  "terrain_tall",
  "terrain_slope",
  "terrain_slope_inner_corner",
  "terrain_slope_outer_corner",
  "terrain_mining",
  "tunnel_straight_A",
  "windturbine_low",
  "windturbine_tall",
];

/** The cached glTF scene of a space-base piece, for instancing (shared geometry and materials). */
export function usePropScene(name: string) {
  return useGLTF(PROP_URL(name)).scene;
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
for (const name of SPACE_PIECES) useGLTF.preload(PROP_URL(name));
