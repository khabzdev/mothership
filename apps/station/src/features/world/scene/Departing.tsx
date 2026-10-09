import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { CRIES, PLEAS, departure } from "../departure";
import { airlock } from "./Airlock";
import { KAYKIT_SCALE, useCharacter } from "./models";

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;

/** A crew member on its way out: to the airlock, through it one at a time, and out into space. */
export function Departing({
  crew,
  path,
  onGone,
}: {
  crew: CrewInfo;
  path: { x: number; z: number }[];
  onGone: () => void;
}) {
  const { scene, animations } = useCharacter(crew.character);
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const { actions } = useAnimations(animations, body);
  const clock = useRef(0);
  const clip = useRef("");
  const [says, setSays] = useState<"plea" | "cry" | null>(null);
  const lines = useMemo(() => ({ plea: pick(PLEAS), cry: pick(CRIES) }), []);

  useEffect(
    () => () => {
      if (airlock.using === crew.id)
        Object.assign(airlock, { inner: 0, outer: 0, red: false, using: null });
    },
    [crew.id],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    let f = departure(path, clock.current + dt);
    // One at a time: wait at the door while someone else is going through.
    if (f.atLock && airlock.using !== crew.id) {
      if (airlock.using) f = departure(path, clock.current);
      else airlock.using = crew.id;
    }
    if (!f.atLock || airlock.using === crew.id) clock.current += dt;
    if (airlock.using === crew.id) {
      airlock.inner = f.inner;
      airlock.outer = f.outer;
      airlock.red = f.red;
    }

    const wanted = f.walking ? "Walking_A" : f.says === "cry" ? "Jump_Idle" : "Idle";
    if (wanted !== clip.current) {
      actions[clip.current]?.fadeOut(0.2);
      actions[wanted]?.reset().fadeIn(0.2).play();
      clip.current = wanted;
    }
    root.current?.position.set(f.x, f.y, f.z);
    if (root.current) root.current.rotation.set(f.tumble, f.facing, f.tumble * 0.6);
    if (f.says !== says) setSays(f.says);
    if (f.done) {
      Object.assign(airlock, { inner: 0, outer: 0, red: false, using: null });
      onGone();
    }
  });

  return (
    <group ref={root}>
      <group ref={body} scale={KAYKIT_SCALE}>
        <primitive object={scene} />
      </group>
      {says && (
        <Html position={[0, 2.1, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
          <div className="speech">{lines[says]}</div>
        </Html>
      )}
    </group>
  );
}
