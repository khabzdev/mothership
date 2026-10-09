import { Stars } from "@react-three/drei";
import { DECK } from "../layout";
import { useProp } from "./models";

const WIDTH = DECK.maxX - DECK.minX;
const DEPTH = DECK.maxZ - DECK.minZ;
const WALL_H = 3.2;

function Prop({
  name,
  position,
  rotation = 0,
  scale = 1,
}: {
  name: string;
  position: [number, number, number];
  rotation?: number;
  scale?: number;
}) {
  const scene = useProp(name);
  return <primitive object={scene} position={position} rotation={[0, rotation, 0]} scale={scale} />;
}

/** The deck shell: plated floor, low bulkheads with viewports to space, cargo along the walls. */
export function Deck() {
  return (
    <group>
      <Stars radius={120} depth={60} count={4000} factor={4} fade speed={0.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[WIDTH, DEPTH]} />
        <meshToonMaterial color="#3a3f4b" />
      </mesh>
      <gridHelper
        args={[WIDTH, WIDTH / 2, "#596173", "#4a5060"]}
        position={[0, 0.01, 0]}
        scale={[1, 1, DEPTH / WIDTH]}
      />

      {/* Bulkheads: low walls so the stars show above them. */}
      {[
        { p: [0, WALL_H / 2, DECK.minZ] as const, s: [WIDTH, WALL_H, 0.3] as const },
        { p: [0, WALL_H / 2, DECK.maxZ] as const, s: [WIDTH, WALL_H, 0.3] as const },
        { p: [DECK.minX, WALL_H / 2, 0] as const, s: [0.3, WALL_H, DEPTH] as const },
        { p: [DECK.maxX, WALL_H / 2, 0] as const, s: [0.3, WALL_H, DEPTH] as const },
      ].map((w, i) => (
        <mesh key={i} position={w.p} castShadow receiveShadow>
          <boxGeometry args={w.s} />
          <meshToonMaterial color="#d9dde6" />
        </mesh>
      ))}
      {/* Orange trim along the base of the bulkheads. */}
      {[DECK.minZ + 0.2, DECK.maxZ - 0.2].map((z) => (
        <mesh key={z} position={[0, 0.15, z]}>
          <boxGeometry args={[WIDTH - 0.4, 0.3, 0.05]} />
          <meshToonMaterial color="#ff5f1f" />
        </mesh>
      ))}

      <Prop
        name="containers_A"
        position={[DECK.maxX - 2.2, 0, DECK.minZ + 2]}
        rotation={-Math.PI / 2}
      />
      <Prop
        name="containers_B"
        position={[DECK.maxX - 2.2, 0, DECK.minZ + 5]}
        rotation={-Math.PI / 2}
      />
      <Prop name="cargo_A_stacked" position={[DECK.maxX - 2, 0, DECK.maxZ - 2]} />
      <Prop name="cargo_B" position={[DECK.minX + 2, 0, DECK.maxZ - 2]} />
      <Prop name="cargo_A" position={[DECK.minX + 2, 0, DECK.minZ + 2]} />
      <Prop name="lights" position={[DECK.minX + 4, 0, DECK.minZ + 1]} />
      <Prop name="lights" position={[DECK.maxX - 6, 0, DECK.maxZ - 1]} rotation={Math.PI} />
    </group>
  );
}
