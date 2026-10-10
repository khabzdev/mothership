import { Stars } from "@react-three/drei";
import { STARS } from "../sky";
import { Garage } from "./Garage";
import { Island } from "./Island";
import { Outpost } from "./Outpost";
import { Sky } from "./Sky";

/** The deck: its terrain island in orbit, the outpost and its garage. */
export function Deck() {
  return (
    <group>
      {/* Behind the sky's planets; star size shrinks with distance, so the factor grows with it. */}
      <Stars radius={STARS.radius} depth={STARS.depth} count={4000} factor={9} fade speed={0.4} />
      <Sky />

      <Island />
      <Outpost />

      <Garage />
    </group>
  );
}
