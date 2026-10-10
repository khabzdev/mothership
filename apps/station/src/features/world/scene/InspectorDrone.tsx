import type { CrewInfo, ServerMsg } from "@mothership/protocol";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  type Group,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
} from "three";
import { useRealtime } from "../../../shared/realtime/RealtimeProvider";
import {
  beatOffset,
  DOCK_Y,
  DRONE_SCALE,
  droneStep,
  droneTarget,
  eyeColor,
  hearVerdict,
  restingDrone,
  type Verdict,
  type Vec3,
} from "../drone";
import { CONSOLES, INSPECTOR_DOCK } from "../layout";
import { chime } from "../sound";
import { GLOW, KIT, PAINTED } from "./materials";

const EYE = {
  cyan: new Color("#4de8ff"),
  green: new Color("#3ddc84"),
  red: new Color(KIT.alarm),
  amber: new Color(KIT.amber),
  dim: new Color("#4de8ff"),
} as const;
/** The eye at rest: lit, but under bloom's threshold. */
const DIM = 0.5;
/** The scan cone in the drone's own (scaled) frame: from the eye down to the console's screen. */
const CONE = { radius: 0.3, length: 1.0, tilt: -0.26, sweep: 0.3 };

/** The verdict a `crew.inspection` message plays, if any: a plain cancel just sends it home. */
function verdictOf(msg: Extract<ServerMsg, { type: "crew.inspection" }>): Verdict | null {
  if (msg.state === "cleared" || msg.state === "flagged") return msg.state;
  if (msg.state === "cancelled" && msg.failed !== undefined) return "failed";
  return null;
}

/**
 * The Inspector: a drone that flies from its pad by Flight Control to the console under review,
 * scans its screen, plays the verdict and flies home. Five meshes, no lights, nothing allocated
 * per frame.
 */
export function InspectorDrone({ deckId, crew }: { deckId: string; crew: CrewInfo[] }) {
  const { client } = useRealtime();
  const target = useMemo(() => droneTarget(crew, CONSOLES), [crew]);
  const targetRef = useRef(target);
  targetRef.current = target;

  const parts = useMemo(() => {
    const cone = new ConeGeometry(CONE.radius, CONE.length, 20, 1, true);
    // Apex at the origin, opening down -y.
    cone.translate(0, -CONE.length / 2, 0);
    return {
      body: new CapsuleGeometry(0.13, 0.14, 6, 14),
      ring: new TorusGeometry(0.23, 0.014, 8, 40),
      eye: new CapsuleGeometry(0.035, 0.05, 4, 8),
      pad: new CircleGeometry(0.34, 32),
      cone,
      shell: new MeshStandardMaterial({ color: KIT.slate, ...PAINTED }),
      glow: new MeshStandardMaterial({
        color: "#000000",
        emissive: EYE.dim,
        emissiveIntensity: DIM,
        toneMapped: false,
      }),
      padGlow: new MeshStandardMaterial({
        color: KIT.charcoal,
        emissive: "#4de8ff",
        emissiveIntensity: 0.6,
        ...PAINTED,
      }),
      beam: new MeshBasicMaterial({
        color: "#4de8ff",
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const part of Object.values(parts)) part.dispose();
    },
    [parts],
  );

  const flight = useMemo(restingDrone, []);
  const shake = useMemo<Vec3>(() => ({ x: 0, y: 0, z: 0 }), []);

  const root = useRef<Group>(null);
  const wobble = useRef<Group>(null);
  const sweep = useRef<Group>(null);

  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type !== "crew.inspection" || msg.deckId !== deckId) return;
      const beat = verdictOf(msg);
      if (!beat) return;
      if (!hearVerdict(flight, msg.crewId, beat)) return;
      if (beat === "cleared") chime();
    });
  }, [client, deckId]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const f = droneStep(flight, now, targetRef.current);
    const { at } = f;
    beatOffset(f.beat, f.beat === "idle" ? now : now - f.since, shake);

    const group = root.current;
    if (group) {
      group.position.set(at.x, at.y, at.z);
      group.rotation.y = f.facing;
    }
    wobble.current?.position.set(shake.x, shake.y, shake.z);

    const color = eyeColor(f.beat);
    parts.glow.emissive.copy(EYE[color]);
    parts.glow.emissiveIntensity =
      color === "dim" ? DIM : f.beat === "cleared" ? GLOW * (1 + 0.5 * Math.sin(now * 14)) : GLOW;

    const scanning = f.beat === "scanning";
    if (sweep.current) {
      sweep.current.visible = scanning;
      sweep.current.rotation.y = CONE.sweep * Math.sin(now * 2.2);
    }
  });

  return (
    <>
      {/* The pad: a softly lit disc on the deck. */}
      <mesh
        geometry={parts.pad}
        material={parts.padGlow}
        position={[INSPECTOR_DOCK.x, 0.012, INSPECTOR_DOCK.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      <group ref={root} position={[INSPECTOR_DOCK.x, DOCK_Y, INSPECTOR_DOCK.z]} scale={DRONE_SCALE}>
        <group ref={wobble}>
          <mesh geometry={parts.body} material={parts.shell} castShadow />
          <mesh geometry={parts.ring} material={parts.glow} rotation={[Math.PI / 2, 0, 0]} />
          {/* The eye: a short lit bar across the front. */}
          <mesh
            geometry={parts.eye}
            material={parts.glow}
            position={[0, 0.04, 0.12]}
            rotation={[0, 0, Math.PI / 2]}
          />
          <group ref={sweep} position={[0, 0.04, 0.12]} visible={false}>
            <mesh geometry={parts.cone} material={parts.beam} rotation={[CONE.tilt, 0, 0]} />
          </group>
        </group>
      </group>
    </>
  );
}
