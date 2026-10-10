import { OUTPOST } from "../outpost";
import { PropInstances } from "./PropInstances";

/** The outpost around the island, each piece drawn as one instanced mesh per glTF mesh. */
export function Outpost() {
  return (
    <group>
      {Object.entries(OUTPOST).map(([name, at]) => (
        <PropInstances key={name} name={name} at={at} castShadow receiveShadow />
      ))}
    </group>
  );
}
