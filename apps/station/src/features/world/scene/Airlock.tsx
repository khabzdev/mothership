import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import type { MeshStandardMaterial } from "three";
import { AIRLOCK } from "../layout";
import { GLOW, KIT } from "./materials";
import { useStationPiece, type StationPiece } from "./models";
import { DOOR_MODULE, DOOR_OPENING, SlidingDoors, WALL_H } from "./SlidingDoors";

/** The airlock's doors and lights, set each frame by whoever is going through it. */
export const airlock = { inner: 0, outer: 0, red: false, using: null as string | null };

const OPEN_W = DOOR_MODULE * DOOR_OPENING.width;
const OPEN_H = WALL_H * DOOR_OPENING.height;
const D = AIRLOCK.depth;
/** Half a bulkhead's thickness. */
const FACE = 0.15;
const IDLE = "#9fb4d8";

/** One Kenney piece, placed once. */
function KitPiece({
  name,
  position,
  rotY = 0,
  scale,
}: {
  name: StationPiece;
  position: [number, number, number];
  rotY?: number;
  scale: [number, number, number];
}) {
  const scene = useStationPiece(name);
  return <primitive object={scene} position={position} rotation={[0, rotY, 0]} scale={scale} />;
}

/** A door's opening read live from the airlock state, for SlidingDoors. */
function useLive(read: () => number): MutableRefObject<number> {
  return useMemo(
    () => ({
      get current() {
        return read();
      },
      set current(_: number) {},
    }),
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/**
 * A chamber outside the east bulkhead: the inner door in the bulkhead's door frame, the outer one
 * in its own frame onto space, both parting into the walls. Built facing the deck along +z, then
 * turned so the deck is to the west.
 */
export function Airlock() {
  const strip = useRef<MeshStandardMaterial>(null);
  const inner = useLive(() => airlock.inner);
  const outer = useLive(() => airlock.outer);
  const side = OPEN_W / 2 + FACE;
  const length = D - FACE;

  useFrame(({ clock }) => {
    const flash = airlock.red ? 0.55 + Math.abs(Math.sin(clock.elapsedTime * 6)) * 0.45 : 0;
    if (strip.current) {
      strip.current.color.set(airlock.red ? KIT.alarm : IDLE);
      strip.current.emissive.set(airlock.red ? KIT.alarm : IDLE);
      strip.current.emissiveIntensity = airlock.red ? GLOW * flash : 0.8;
    }
  });

  return (
    <group position={[AIRLOCK.x, 0, AIRLOCK.z]} rotation={[0, -Math.PI / 2, 0]}>
      {/* Chamber: side walls, floor and roof from the kit. */}
      {[-1, 1].map((s) => (
        <KitPiece
          key={s}
          name="wall"
          position={[s * side, 0, -FACE - length / 2]}
          rotY={Math.PI / 2}
          scale={[length, WALL_H, 1]}
        />
      ))}
      <KitPiece name="floor-panel" position={[0, -0.15, -D / 2]} scale={[side * 2, 0.5, D]} />
      <KitPiece
        name="floor"
        position={[0, WALL_H, -D / 2]}
        scale={[side * 2 + 0.3, 0.5, D + 0.3]}
      />
      {/* Outer frame onto space. */}
      <KitPiece name="wall-door-wide" position={[0, 0, -D]} scale={[DOOR_MODULE, WALL_H, 1]} />

      <SlidingDoors width={OPEN_W} height={OPEN_H} open={inner} />
      <group position={[0, 0, -D]}>
        <SlidingDoors width={OPEN_W} height={OPEN_H} open={outer} />
      </group>

      {/* Status light over the inner door, on the deck side: calm blue, red while cycling. */}
      <mesh position={[0, OPEN_H + 0.32, FACE + 0.03]}>
        <boxGeometry args={[OPEN_W - 0.2, 0.07, 0.04]} />
        <meshStandardMaterial
          ref={strip}
          color={IDLE}
          emissive={IDLE}
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
