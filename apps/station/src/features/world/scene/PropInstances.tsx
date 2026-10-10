import { useLayoutEffect, useMemo, useRef } from "react";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D } from "three";
import type { Placement } from "../placement.ts";
import { usePropScene } from "./models.ts";

interface Part {
  geometry: BufferGeometry;
  material: Material | Material[];
  /** The mesh's matrix relative to the piece root. */
  local: Matrix4;
}

/** Every mesh of a piece, with its world matrix relative to the piece root baked in. */
function collectParts(scene: Object3D): Part[] {
  scene.updateWorldMatrix(true, true);
  const inverseRoot = scene.matrixWorld.clone().invert();
  const parts: Part[] = [];
  scene.traverse((node: Object3D) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    parts.push({
      geometry: mesh.geometry,
      material: mesh.material,
      local: new Matrix4().multiplyMatrices(inverseRoot, mesh.matrixWorld),
    });
  });
  return parts;
}

/** Draws one space-base piece at many placements: one InstancedMesh per mesh in its glTF. */
export function PropInstances({
  name,
  at,
  castShadow = true,
  receiveShadow = true,
}: {
  name: string;
  at: Placement[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}) {
  const scene = usePropScene(name);
  const parts = useMemo(() => collectParts(scene), [scene]);
  const refs = useRef<(InstancedMesh | null)[]>([]);

  useLayoutEffect(() => {
    const placed = new Matrix4();
    const instance = new Matrix4();
    const rotation = new Quaternion();
    const euler = new Euler();
    const position = new Vector3();
    const scale = new Vector3();
    parts.forEach((part, k) => {
      const mesh = refs.current[k];
      if (!mesh) return;
      at.forEach((p, i) => {
        rotation.setFromEuler(euler.set(0, p.rotY, 0));
        placed.compose(position.set(...p.position), rotation, scale.setScalar(p.scale));
        instance.multiplyMatrices(placed, part.local);
        mesh.setMatrixAt(i, instance);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [at, parts]);

  return (
    <group>
      {parts.map((part, k) => (
        <instancedMesh
          // Changing `at.length` needs a fresh buffer, so it is part of the key.
          key={`${name}-${k}-${at.length}`}
          ref={(m) => {
            refs.current[k] = m;
          }}
          args={[part.geometry, part.material, at.length]}
          castShadow={castShadow}
          receiveShadow={receiveShadow}
        />
      ))}
    </group>
  );
}
