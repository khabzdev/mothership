import type { CrewInfo } from "@mothership/protocol";
import { Html, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { Group, Mesh } from "three";
import { ActHold, actFor } from "../acting";
import { useWorld } from "../store";
import { removeTypist, setTyping } from "../sound";
import { consoleSeat, type ConsoleDef } from "../layout";
import { ActProps, type ActPropsHandle } from "./ActProps";
import { Beacon } from "./Beacon";
import { CHAIR_Z } from "./Console";
import { KAYKIT_SCALE, useCharacter } from "./models";
import { PoseLayer, poseDebug, poseFor } from "./pose";
import { StatusBadge } from "../ui/StatusBadge";
import { STATUS_COLORS } from "./status";

/** Seated at the console unless it's waving for you or celebrating (agent-office's stances). */
export function stanceFor(crew: Pick<CrewInfo, "status" | "action">): {
  clip: string;
  seated: boolean;
} {
  switch (crew.status) {
    case "needs_input":
      return { clip: "Spellcast_Raise", seated: false };
    case "done":
      return { clip: "Cheer", seated: false };
    default:
      return { clip: "Sit_Chair_Idle", seated: true };
  }
}

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
  const { scene, animations } = useCharacter(crew.character);
  const body = useRef<Group>(null);
  const light = useRef<Mesh>(null);
  const { actions } = useAnimations(animations, body);
  const cheering = useWorld((s) => s.cheering);
  // A launch gets everyone awake on their feet, cheering (agent-office's desk dance).
  const { clip, seated } =
    cheering && crew.status !== "asleep" ? { clip: "Cheer", seated: false } : stanceFor(crew);
  // Seated in the console's chair, or standing just behind it.
  const seat = consoleSeat(def, seated ? SEATED : 1.45);

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
    let act = hold.current.at(seated ? actFor(crew) : "rest", t);
    if (import.meta.env.DEV && seated && poseDebug.act) act = poseDebug.act;
    layer.apply((import.meta.env.DEV && seated && poseDebug.pose) || poseFor(act, t), delta);
    props.current?.update(act, t, hands);
    setTyping(crew.id, seat.x, seat.z, act === "type" || act === "edit");
    if (!light.current) return;
    const pulse = crew.status === "needs_input" ? 1 + Math.sin(clock.elapsedTime * 8) * 0.35 : 1;
    light.current.scale.setScalar(pulse);
  });

  return (
    <>
      {crew.status === "needs_input" && <Beacon x={seat.x} z={seat.z} top={2.6} />}
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
