import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { CRIES, PLEAS, departure, queueTurn, walkTime } from "../departure";
import { garage } from "./Garage";
import { KAYKIT_SCALE, useCharacter } from "./models";

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;

/** Let go of the garage door (and its place in line), shutting the door if it was going through. */
function leave(id: string) {
  if (garage.using === id) Object.assign(garage, { door: 0, using: null });
  const i = garage.queue.indexOf(id);
  if (i >= 0) garage.queue.splice(i, 1);
}

/** A crew member on its way out: to the garage, and through its door one at a time. */
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

  // Where it waits its turn: the last corner before the door.
  const queueAt = useMemo(() => walkTime(path.slice(0, -1)), [path]);

  useEffect(() => () => leave(crew.id), [crew.id]);

  const gone = useRef(false);

  useFrame((_, delta) => {
    if (gone.current) return;
    let t = clock.current + Math.min(delta, 0.1);
    // One at a time: wait in line (each place a little further back) while someone else is going through.
    if (garage.using !== crew.id) {
      const turn = queueTurn(garage.queue, garage.using, crew.id, queueAt);
      if (t >= turn.limit) {
        if (!garage.queue.includes(crew.id)) garage.queue.push(crew.id);
        if (turn.go) {
          // Its turn: walk on to the corner, then through.
          if (t >= queueAt) {
            garage.queue.splice(garage.queue.indexOf(crew.id), 1);
            garage.using = crew.id;
          }
        } else t = Math.min(t, turn.limit);
      }
    }
    clock.current = t;
    const f = departure(path, t);
    if (garage.using === crew.id) garage.door = f.door;

    const wanted = f.walking ? "Walking_A" : f.says === "cry" ? "Jump_Idle" : "Idle";
    if (wanted !== clip.current) {
      actions[clip.current]?.fadeOut(0.2);
      actions[wanted]?.reset().fadeIn(0.2).play();
      clip.current = wanted;
    }
    root.current?.position.set(f.x, f.y, f.z);
    if (root.current) root.current.rotation.y = f.facing;
    if (f.says !== says) setSays(f.says);
    if (f.done) {
      gone.current = true;
      leave(crew.id);
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
