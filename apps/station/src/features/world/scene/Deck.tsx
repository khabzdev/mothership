import { Stars } from "@react-three/drei";
import { Airlock } from "./Airlock";
import { Island } from "./Island";
import { Outpost } from "./Outpost";

/** The deck: its terrain island, the outpost and the airlock. */
export function Deck() {
  return (
    <group>
      <Stars radius={120} depth={60} count={4000} factor={4} fade speed={0.4} />

      <Island />
      <Outpost />

      <Airlock />
    </group>
  );
}
