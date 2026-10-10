import { useSuspenseQuery } from "@tanstack/react-query";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { AdditiveBlending, Color, type Group, type Mesh } from "three";
import { decksQuery } from "../../decks/queries";
import { useDeckChoice } from "../deck-choice";
import { SHIP_PAD } from "../layout";
import { OUTPOST_SCALE, PAD_TOP } from "../outpost";
import { flightOutcome, restingPose, shipPose } from "../ship";
import { useWorld } from "../store";
import { stepOutOfShip } from "./Captain";
import { GLOW } from "./materials";
import { useProp } from "./models";

/** The engine's flame, bright enough to bloom. */
const FLAME = new Color("#ffb020").multiplyScalar(GLOW);

/**
 * Your ship on its pad at the north edge. Pick a deck in its Flight plan and it rumbles, lifts off
 * and climbs out of sight (the camera holds its view), then the deck switches; on the new deck it
 * comes down onto the pad and you step out.
 */
export function ShipPad() {
  const pad = useProp("landingpad_large");
  const lander = useProp("lander_A");
  const ship = useRef<Group>(null);
  const flame = useRef<Mesh>(null);
  const { data: decks } = useSuspenseQuery(decksQuery);
  const { deckId, choose } = useDeckChoice();
  const pose = useRef(restingPose());
  /** The flight (by when it was picked) already flown, so the deck switches exactly once. */
  const flown = useRef<number | null>(null);
  /** When the landing began (ms). */
  const landing = useRef<number | null>(null);

  useFrame(() => {
    const { flight, arriving, endFlight, setArriving } = useWorld.getState();
    const now = Date.now();
    const p = pose.current;
    if (flight) {
      shipPose("takeoff", (now - flight.at) / 1000, p);
      if (p.done && flown.current !== flight.at) {
        flown.current = flight.at;
        // Switched deck some other way mid-flight, or the deck's gone: the flight just ends.
        const ids = decks.map((d) => d.id);
        if (flightOutcome(flight, deckId, ids) === "fly") {
          setArriving(true);
          choose(flight.to);
        }
        endFlight();
      }
    } else if (arriving) {
      landing.current ??= now;
      shipPose("landing", (now - landing.current) / 1000, p);
      if (p.done) {
        landing.current = null;
        stepOutOfShip();
        setArriving(false);
      }
    } else {
      landing.current = null;
      shipPose("landing", Infinity, p);
    }

    const s = ship.current;
    if (s) {
      s.position.set(
        SHIP_PAD.x + Math.sin(now * 0.06) * p.shake,
        PAD_TOP + p.y,
        SHIP_PAD.z + Math.cos(now * 0.05) * p.shake,
      );
    }
    const f = flame.current;
    if (f) {
      f.visible = p.flame > 0.01;
      f.scale.set(p.flame, p.flame * (1 + Math.random() * 0.4), p.flame);
    }
  });

  return (
    <>
      <primitive object={pad} position={[SHIP_PAD.x, 0, SHIP_PAD.z]} scale={OUTPOST_SCALE} />
      <group ref={ship} position={[SHIP_PAD.x, PAD_TOP, SHIP_PAD.z]}>
        <primitive object={lander} scale={OUTPOST_SCALE} />
        <mesh ref={flame} position={[0, -0.6, 0]} rotation={[Math.PI, 0, 0]} visible={false}>
          <coneGeometry args={[0.5, 1.6, 16, 1, true]} />
          <meshBasicMaterial
            color={FLAME}
            transparent
            opacity={0.9}
            blending={AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}
