import { forwardRef, useImperativeHandle, useRef } from "react";
import { Color, Vector3, type Group, type Object3D } from "three";

/** The hologram's colours, over 1 so it glows. */
const HOLO = new Color("#4cc9f0").multiplyScalar(1.5);
const LAND_GLOW = new Color("#7ef0ad").multiplyScalar(1.5);
const RING_GLOW = new Color("#ffd166").multiplyScalar(1.8);
import type { Act } from "../acting";

// What a crew member acts out its tool calls with (agent-office's worker-props.ts): papers held up
// to read, their top sheet flipping over, and a globe for the web, here a spinning hologram.

const PAPER = { w: 0.24, h: 0.31 };
const LAND: [lat: number, lon: number, size: number][] = [
  [0.5, 0.2, 0.5],
  [0.1, 0.9, 0.4],
  [-0.4, 0.5, 0.45],
  [0.3, 2.4, 0.6],
  [-0.2, 3.3, 0.4],
  [0.6, 4.4, 0.45],
  [-0.5, 5.2, 0.35],
];

export interface ActPropsHandle {
  /** Show the props for `act`; `hands` are the character's hand bones. Call after posing. */
  update(act: Act, t: number, hands: [Object3D, Object3D] | null): void;
}

const a = new Vector3();
const b = new Vector3();

/** Lives in the crew member's seat group: +z faces the console, y is up, metres. */
export const ActProps = forwardRef<ActPropsHandle>(function ActProps(_, ref) {
  const papers = useRef<Group>(null);
  const page = useRef<Group>(null);
  const globe = useRef<Group>(null);
  const ball = useRef<Group>(null);

  useImperativeHandle(ref, () => ({
    update(act, t, hands) {
      const p = papers.current;
      if (p) {
        p.visible = act === "read" && !!hands;
        if (p.visible && hands && p.parent) {
          // Held between its hands, tipped back toward its face.
          hands[0].getWorldPosition(a);
          hands[1].getWorldPosition(b);
          p.parent.worldToLocal(a.add(b).multiplyScalar(0.5));
          p.position.set(a.x, a.y + 0.08, a.z + 0.05);
        }
        // The top sheet flips over every couple of seconds.
        if (page.current) page.current.rotation.x = -(Math.max(0, Math.sin(t * 1.6)) ** 6) * 2.6;
      }
      if (globe.current) globe.current.visible = act === "web";
      if (ball.current) ball.current.rotation.y = t * 1.4;
    },
  }));

  return (
    <>
      <group ref={papers} visible={false} rotation={[-0.35, 0, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            position={[(i - 1) * 0.008, 0, -i * 0.006]}
            rotation={[0, 0, (i - 1) * 0.04]}
          >
            <boxGeometry args={[PAPER.w, PAPER.h, 0.005]} />
            <meshStandardMaterial color={["#e9e4d8", "#f3efe6", "#fffaf3"][i]} roughness={0.9} />
          </mesh>
        ))}
        {/* The top sheet hangs from the clip at the top, so it flips up and over. */}
        <group ref={page} position={[0, PAPER.h / 2, 0.006]}>
          <mesh position={[0, -PAPER.h / 2, 0]}>
            <boxGeometry args={[PAPER.w, PAPER.h, 0.005]} />
            <meshStandardMaterial color="#fffaf3" roughness={0.9} />
          </mesh>
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} position={[i % 3 === 2 ? -0.03 : 0, -0.05 - i * 0.045, 0.004]}>
              <boxGeometry args={[PAPER.w * (i % 3 === 2 ? 0.45 : 0.72), 0.012, 0.002]} />
              <meshStandardMaterial color="#8d99ae" roughness={0.9} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, PAPER.h / 2, 0.01]}>
          <boxGeometry args={[PAPER.w * 0.5, 0.035, 0.03]} />
          <meshStandardMaterial color="#adb5bd" roughness={0.4} metalness={0.6} />
        </mesh>
      </group>

      {/* A holo globe over the desk, between the crew member and its screen. */}
      <group ref={globe} visible={false} position={[0, 1.22, 0.62]}>
        <group ref={ball} rotation={[0, 0, 0.41]}>
          <mesh>
            <sphereGeometry args={[0.17, 20, 14]} />
            <meshBasicMaterial color={HOLO} transparent opacity={0.75} toneMapped={false} />
          </mesh>
          {LAND.map(([lat, lon, size], i) => (
            <mesh
              key={i}
              position={[
                Math.cos(lat) * Math.sin(lon) * 0.15,
                Math.sin(lat) * 0.15,
                Math.cos(lat) * Math.cos(lon) * 0.15,
              ]}
              scale={[1.2, 0.8, 1.2]}
            >
              <sphereGeometry args={[size * 0.17, 10, 8]} />
              <meshBasicMaterial color={LAND_GLOW} transparent opacity={0.85} toneMapped={false} />
            </mesh>
          ))}
        </group>
        <mesh rotation={[Math.PI / 2 - 0.2, 0, 0]}>
          <torusGeometry args={[0.23, 0.01, 6, 32]} />
          <meshBasicMaterial color={RING_GLOW} toneMapped={false} />
        </mesh>
        {/* The beam it's projected from. */}
        <mesh position={[0, -0.27, 0]}>
          <cylinderGeometry args={[0.03, 0.12, 0.3, 16, 1, true]} />
          <meshBasicMaterial color="#4cc9f0" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
});
