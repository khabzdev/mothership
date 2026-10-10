import { useMemo } from "react";
import { islandPlan, type TerrainPiece } from "../island";
import { PropInstances } from "./PropInstances";

/** The deck's terrain island: every KayKit tile drawn as one instanced mesh per piece. */
export function Island() {
  const plan = useMemo(islandPlan, []);
  return (
    <group>
      {(Object.keys(plan) as TerrainPiece[])
        .filter((piece) => plan[piece].length > 0)
        .map((piece) => (
          <PropInstances
            key={piece}
            name={piece}
            at={plan[piece]}
            castShadow={false}
            receiveShadow
          />
        ))}
    </group>
  );
}
