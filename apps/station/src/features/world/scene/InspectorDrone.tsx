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
  droneFlight,
  droneTarget,
  eyeColor,
  FLY_S,
  HOVER_Y,
  VERDICT_S,
  type DroneBeat,
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
/** Facing the deck from the pad (its front is +z; the deck lies north, -z). */
const DOCK_FACING = Math.PI;
/** How long it waits once its review is gone before heading home: the verdict may still be on its way. */
const LINGER_S = 0.4;
/** The scan cone: from the eye down to the console's screen. */
const CONE = { radius: 0.24, length: 0.7, tilt: -0.52, sweep: 0.3 };

type Target = NonNullable<ReturnType<typeof droneTarget>>;
type Verdict = Extract<DroneBeat, "cleared" | "flagged" | "failed">;

/** The verdict a `crew.inspection` message plays, if any: a plain cancel just sends it home. */
function verdictOf(msg: Extract<ServerMsg, { type: "crew.inspection" }>): Verdict | null {
  if (msg.state === "cleared" || msg.state === "flagged") return msg.state;
  if (msg.state === "cancelled" && msg.failed !== undefined) return "failed";
  return null;
}

/** The shortest way round from angle `a` to `b`, `s` of the way (0 to 1). */
function turn(a: number, b: number, s: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * s;
}

interface Flight {
  beat: DroneBeat;
  /** When the beat (or flight) began, on the frame clock (s); -1: on the next frame. */
  since: number;
  from: Vec3;
  to: Vec3;
  fromFacing: number;
  toFacing: number;
  /** The crew member it's flying to or scanning. */
  crewId: string | null;
  /** When its review left the roster (s), or -1 while it's there. */
  lostAt: number;
  /** A verdict heard over the hub, played on the next frame. */
  verdict: { crewId: string; beat: Verdict } | null;
}

/** Start a flight from where the drone is (`at`, facing `facingNow`) to (x, y, z), facing `toFacing`. */
function fly(
  f: Flight,
  at: Vec3,
  facingNow: number,
  now: number,
  beat: DroneBeat,
  x: number,
  y: number,
  z: number,
  toFacing: number,
): void {
  f.beat = beat;
  f.since = now;
  f.from.x = at.x;
  f.from.y = at.y;
  f.from.z = at.z;
  f.to.x = x;
  f.to.y = y;
  f.to.z = z;
  f.fromFacing = facingNow;
  f.toFacing = toFacing;
}

/** Fly to the review under way, or home to the pad when there's none. */
function moveOn(f: Flight, at: Vec3, facingNow: number, now: number, next: Target | null): void {
  f.lostAt = -1;
  f.crewId = next?.crewId ?? null;
  if (next) fly(f, at, facingNow, now, "flying", next.x, HOVER_Y, next.z, next.facing);
  else
    fly(
      f,
      at,
      facingNow,
      now,
      "returning",
      INSPECTOR_DOCK.x,
      DOCK_Y,
      INSPECTOR_DOCK.z,
      DOCK_FACING,
    );
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

  const flight = useRef<Flight>({
    beat: "idle",
    since: 0,
    from: { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z },
    to: { x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z },
    fromFacing: DOCK_FACING,
    toFacing: DOCK_FACING,
    crewId: null,
    lostAt: -1,
    verdict: null,
  });
  const at = useMemo<Vec3>(() => ({ x: INSPECTOR_DOCK.x, y: DOCK_Y, z: INSPECTOR_DOCK.z }), []);
  const shake = useMemo<Vec3>(() => ({ x: 0, y: 0, z: 0 }), []);
  const facing = useRef(DOCK_FACING);

  const root = useRef<Group>(null);
  const wobble = useRef<Group>(null);
  const sweep = useRef<Group>(null);

  useEffect(() => {
    if (!client) return;
    return client.onMessage((msg) => {
      if (msg.type !== "crew.inspection" || msg.deckId !== deckId) return;
      const beat = verdictOf(msg);
      if (!beat) return;
      const f = flight.current;
      // Its own review's verdict, or (resting at its pad) one it never got to fly to.
      const resting = f.beat === "idle" || f.beat === "returning";
      if (f.crewId !== msg.crewId && !resting) return;
      f.verdict = { crewId: msg.crewId, beat };
      if (beat === "cleared") chime();
    });
  }, [client, deckId]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const f = flight.current;

    const next = targetRef.current;

    // A verdict plays where it is, then it moves on.
    if (f.verdict) {
      f.beat = f.verdict.beat;
      f.since = now;
      f.crewId = null;
      f.verdict = null;
      // Settle where it is: a flight cut short stops here.
      f.from.x = f.to.x = at.x;
      f.from.y = f.to.y = at.y;
      f.from.z = f.to.z = at.z;
      f.fromFacing = f.toFacing = facing.current;
    }
    const verdict = f.beat === "cleared" || f.beat === "flagged" || f.beat === "failed";
    const elapsed = now - f.since;
    if (next) f.lostAt = -1;
    if (verdict) {
      if (elapsed >= VERDICT_S) moveOn(f, at, facing.current, now, next);
    } else if (next && next.crewId !== f.crewId) {
      moveOn(f, at, facing.current, now, next);
    } else if (!next && f.crewId) {
      // Its review is gone: wait a moment for the verdict, then head home.
      if (f.lostAt < 0) f.lostAt = now;
      else if (now - f.lostAt >= LINGER_S) moveOn(f, at, facing.current, now, null);
    } else if (f.beat === "flying" && elapsed >= FLY_S) {
      f.beat = "scanning";
    } else if (f.beat === "returning" && elapsed >= FLY_S) {
      f.beat = "idle";
    }

    const t = (now - f.since) / FLY_S;
    droneFlight(f.from, f.to, f.beat === "flying" || f.beat === "returning" ? t : 1, at);
    facing.current = turn(f.fromFacing, f.toFacing, Math.min(1, Math.max(0, t)));
    beatOffset(f.beat, f.beat === "idle" ? now : now - f.since, shake);

    const group = root.current;
    if (group) {
      group.position.set(at.x, at.y, at.z);
      group.rotation.y = facing.current;
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
      <group ref={root} position={[INSPECTOR_DOCK.x, DOCK_Y, INSPECTOR_DOCK.z]}>
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
