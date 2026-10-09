import { Stars } from "@react-three/drei";
import { useRef } from "react";
import type { Object3D } from "three";
import { AIRLOCK, DECK } from "../layout";
import type { DeckPaint } from "../paint";
import { Airlock } from "./Airlock";
import { Furniture } from "./Furniture";
import { useProp } from "./models";
import { useSolid } from "./solid";

const WIDTH = DECK.maxX - DECK.minX;
const DEPTH = DECK.maxZ - DECK.minZ;
const WALL_H = 3.2;
/** Half the airlock doorway's width, a little wider than its door. */
const DOORWAY = AIRLOCK.halfWidth + 0.2;

function Prop({
  name,
  position,
  rotation = 0,
  scale = 1,
  solid = false,
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
  solid?: boolean;
}) {
  const scene = useProp(name);
  const ref = useRef<Object3D>(null);
  useSolid(ref, solid);
  return (
    <primitive
      ref={ref}
      object={scene}
      position={position}
      rotation={[0, rotation, 0]}
      scale={scale}
    />
  );
}

/** The deck shell: plated floor, low bulkheads with viewports to space, cargo along the walls. */
export function Deck({ paint }: { paint: DeckPaint }) {
  return (
    <group>
      <Stars radius={120} depth={60} count={4000} factor={4} fade speed={0.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[WIDTH, DEPTH]} />
        <meshToonMaterial color={paint.floor} />
      </mesh>
      <gridHelper
        args={[WIDTH, WIDTH / 2, paint.grid[0], paint.grid[1]]}
        position={[0, 0.01, 0]}
        scale={[1, 1, DEPTH / WIDTH]}
      />

      {/* Bulkheads: low walls so the stars show above them. */}
      {[
        { p: [0, WALL_H / 2, DECK.minZ] as const, s: [WIDTH, WALL_H, 0.3] as const },
        { p: [0, WALL_H / 2, DECK.maxZ] as const, s: [WIDTH, WALL_H, 0.3] as const },
        { p: [DECK.minX, WALL_H / 2, 0] as const, s: [0.3, WALL_H, DEPTH] as const },
        // East bulkhead, with the airlock's doorway in the middle.
        {
          p: [DECK.maxX, WALL_H / 2, (DECK.minZ + AIRLOCK.z - DOORWAY) / 2] as const,
          s: [0.3, WALL_H, AIRLOCK.z - DOORWAY - DECK.minZ] as const,
        },
        {
          p: [DECK.maxX, WALL_H / 2, (DECK.maxZ + AIRLOCK.z + DOORWAY) / 2] as const,
          s: [0.3, WALL_H, DECK.maxZ - AIRLOCK.z - DOORWAY] as const,
        },
      ].map((w, i) => (
        <mesh key={i} position={w.p} castShadow receiveShadow>
          <boxGeometry args={w.s} />
          <meshToonMaterial color={paint.wall} />
        </mesh>
      ))}
      {/* Orange trim along the base of the bulkheads. */}
      {[DECK.minZ + 0.2, DECK.maxZ - 0.2].map((z) => (
        <mesh key={z} position={[0, 0.15, z]}>
          <boxGeometry args={[WIDTH - 0.4, 0.3, 0.05]} />
          <meshToonMaterial color={paint.trim} />
        </mesh>
      ))}

      <Airlock />

      {/* Cargo bay corner (north-east). */}
      <Prop
        name="containers_A"
        position={[DECK.maxX - 2.2, 0, DECK.minZ + 2]}
        rotation={-Math.PI / 2}
        solid
      />
      <Prop name="cargo_A_stacked" position={[DECK.maxX - 2, 0, DECK.minZ + 5]} solid />

      {/* Lounge (south-east), like agent-office's couches by the windows. */}
      <Furniture
        name="rug_rectangle_stripes_A"
        position={[12.5, 0.01, 8.5]}
        scale={[1.6, 1, 1.6]}
      />
      <Furniture name="couch_pillows" position={[12.5, 0, 11.2]} rotation={Math.PI} solid />
      <Furniture name="armchair_pillows" position={[9.4, 0, 8.5]} rotation={Math.PI / 2} solid />
      <Furniture name="armchair" position={[15.6, 0, 8.5]} rotation={-Math.PI / 2} solid />
      <Furniture name="table_low" position={[12.5, 0, 8.5]} solid />
      <Furniture name="lamp_standing" position={[16.4, 0, 11.6]} solid />
      <Furniture name="cactus_medium_A" position={[8.6, 0, 11.6]} solid />

      {/* Library wall (north): shelves, a cabinet and pictures. */}
      <Furniture name="shelf_B_large_decorated" position={[3, 1.5, DECK.minZ + 0.45]} />
      <Furniture name="shelf_B_large_decorated" position={[6.2, 1.5, DECK.minZ + 0.45]} />
      <Furniture name="cabinet_medium_decorated" position={[4.6, 0, DECK.minZ + 0.6]} solid />
      {/* The north wall's west half holds the Mission and Launch boards (scene/Board.tsx). */}
      <Furniture name="pictureframe_large_B" position={[0.4, 2, DECK.minZ + 0.25]} />

      {/* Plants and lamps around the pods. */}
      <Furniture name="cactus_medium_B" position={[DECK.minX + 1, 0, DECK.minZ + 1]} solid />
      <Furniture name="cactus_small_A" position={[DECK.minX + 1, 0, DECK.maxZ - 1]} solid />
      <Furniture name="cactus_medium_A" position={[1.4, 0, 0]} solid />
      <Furniture name="lamp_standing" position={[-14.5, 0, 0]} solid />
      <Furniture
        name="cabinet_small"
        position={[DECK.minX + 0.6, 0, -6]}
        rotation={Math.PI / 2}
        solid
      />
      <Furniture
        name="cabinet_small"
        position={[DECK.minX + 0.6, 0, 6]}
        rotation={Math.PI / 2}
        solid
      />
      <Prop name="lights" position={[DECK.minX + 4, 0, DECK.minZ + 1]} solid />
    </group>
  );
}
