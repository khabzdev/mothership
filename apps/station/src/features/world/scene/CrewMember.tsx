import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Group, Mesh } from "three";
import { ActHold, actFor, stanceFor } from "../acting";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import { salutes } from "../../ranks/model";
import { RankChevrons } from "../../ranks/ui/RankChevrons";
import { useWorld } from "../store";
import { removeTypist, setTyping } from "../sound";
import { consoleSeat, type ConsoleDef } from "../layout";
import { ActProps, type ActPropsHandle } from "./ActProps";
import { Beacon } from "./Beacon";
import { Confetti } from "./Confetti";
import { CHAIR_Z } from "./Console";
import { KAYKIT_SCALE, useCharacter } from "./models";
import { PoseLayer, poseDebug, poseFor } from "./pose";
import { usePreflightTurn } from "./useTurn";
import { StatusBadge } from "../ui/StatusBadge";
import { STATUS_COLORS } from "./status";

/** How long the cheer on GO and the failing act on NO-GO last (ms). */
const CHEER_MS = 2500;
const FAIL_MS = 3000;
/** A promotion's confetti: a small burst at the console, under a second. */
const SALUTE_CONFETTI = 40;
const SALUTE_CONFETTI_S = 0.9;

/**
 * Where a seated crew member's origin goes, from the console's middle. Sit_Chair_Idle puts the
 * hips 0.28 m behind the origin, so this lands them on the cushion just in front of the backrest
 * of the chair at CHAIR_Z.
 */
const SEATED = CHAIR_Z - 0.19;
/** And how far up: thighs on the cushion rather than in it. */
const SEAT_LIFT = 0.03;

/** A crew member at its console, acting out what its agent is doing. */
export function CrewMember({ crew, def }: { crew: CrewInfo; def: ConsoleDef }) {
  const { client } = useRealtime();
  const { scene, animations } = useCharacter(crew.character);
  const body = useRef<Group>(null);
  const light = useRef<Mesh>(null);
  const { actions } = useAnimations(animations, body);
  const cheering = useWorld((s) => s.cheering);
  const goAt = usePreflightTurn(crew.preflight, "go");
  const nogoAt = usePreflightTurn(crew.preflight, "nogo");
  // Promoted or awarded a patch: it salutes, the same cheer as a GO.
  const [saluteAt, setSaluteAt] = useState(0);
  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (!salutes(msg, crew.deckId, crew.id)) return;
      // A rank and a patch arrive together: one salute, one burst.
      const now = Date.now();
      setSaluteAt((at) => (now < at + CHEER_MS ? at : now));
    });
  }, [client, crew.deckId, crew.id]);
  const [, tick] = useState(0);
  // The cheer and the failing act each last a few seconds from the moment the verdict turns.
  useEffect(() => {
    const ends = [goAt + CHEER_MS, saluteAt + CHEER_MS, nogoAt + FAIL_MS].filter(
      (t) => t > Date.now(),
    );
    if (!ends.length) return;
    const id = setTimeout(() => tick((n) => n + 1), Math.min(...ends) - Date.now() + 20);
    return () => clearTimeout(id);
  }, [goAt, saluteAt, nogoAt]);
  const saluting = saluteAt > 0 && Date.now() < saluteAt + CHEER_MS;
  const cheerGo = (goAt > 0 && Date.now() < goAt + CHEER_MS) || saluting;
  const failing = nogoAt > 0 && Date.now() < nogoAt + FAIL_MS;
  // A launch gets everyone awake on their feet, cheering (agent-office's desk dance).
  const { clip, seated } =
    (cheering || cheerGo) && crew.status !== "asleep"
      ? { clip: "Cheer", seated: false }
      : stanceFor(crew);
  // Seated in the console's chair, or standing just behind it.
  const seat = consoleSeat(def, seated ? SEATED : 1.45);
  const desk = useMemo(() => consoleSeat(def, 0), [def]);

  useEffect(() => {
    const action = actions[clip] ?? actions.Idle;
    action?.reset().fadeIn(0.25).play();
    return () => void action?.fadeOut(0.25);
  }, [actions, clip]);

  const layer = useMemo(() => new PoseLayer(scene), [scene]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    poseDebug.scenes.set(crew.name, scene);
    return () => void poseDebug.scenes.delete(crew.name);
  }, [crew.name, scene]);
  const hold = useRef(new ActHold());
  useEffect(() => () => removeTypist(crew.id), [crew.id]);
  const props = useRef<ActPropsHandle>(null);
  const hands = useMemo(() => {
    const l = scene.getObjectByName("handl") ?? scene.getObjectByName("hand.l");
    const r = scene.getObjectByName("handr") ?? scene.getObjectByName("hand.r");
    return l && r ? ([l, r] as [typeof l, typeof r]) : null;
  }, [scene]);

  // Runs after useAnimations' mixer update (registered first), so the offsets sit on top of the clip.
  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    let act = hold.current.at(seated ? (failing ? "failing" : actFor(crew)) : "rest", t);
    if (import.meta.env.DEV && seated && poseDebug.act) act = poseDebug.act;
    layer.apply((import.meta.env.DEV && seated && poseDebug.pose) || poseFor(act, t), delta);
    props.current?.update(
      act,
      t,
      hands,
      crew.brief?.state === "waiting" && crew.status !== "asleep",
    );
    setTyping(crew.id, seat.x, seat.z, act === "type" || act === "edit");
    if (!light.current) return;
    const pulse = crew.status === "needs_input" ? 1 + Math.sin(clock.elapsedTime * 8) * 0.35 : 1;
    light.current.scale.setScalar(pulse);
  });

  return (
    <>
      {crew.status === "needs_input" && <Beacon x={seat.x} z={seat.z} top={2.6} />}
      {saluting && (
        <Confetti
          key={saluteAt}
          x={desk.x}
          z={desk.z}
          start={saluteAt}
          count={SALUTE_CONFETTI}
          seconds={SALUTE_CONFETTI_S}
          speed={0.5}
        />
      )}
      <group
        position={[seat.x, seated ? SEAT_LIFT : 0, seat.z]}
        rotation={[0, def.rotY + Math.PI, 0]}
      >
        <group ref={body} scale={KAYKIT_SCALE}>
          <primitive object={scene} />
        </group>
        <ActProps ref={props} />
        <mesh ref={light} position={[0, seated ? 1.45 : 1.85, 0]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshStandardMaterial
            color={STATUS_COLORS[crew.status]}
            emissive={STATUS_COLORS[crew.status]}
            emissiveIntensity={crew.status === "needs_input" ? 3 : 1.6}
            toneMapped={false}
          />
        </mesh>
        <Html position={[0, seated ? 1.9 : 2.3, 0]} center distanceFactor={9} zIndexRange={[10, 0]}>
          <div className="crew-tag" data-status={crew.status}>
            <span className="crew-tag__name">
              <span className="dot" style={{ "--dot": crew.color } as CSSProperties} />
              <RankChevrons title={crew.rank?.title} />
              {crew.name}
            </span>
            <StatusBadge crew={crew} />
            {crew.task && <span className="crew-tag__task">{crew.task.split("\n")[0]}</span>}
          </div>
        </Html>
      </group>
    </>
  );
}
