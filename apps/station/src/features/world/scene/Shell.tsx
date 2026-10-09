import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from "three";
import { WALL_H, bulkheads, type Module } from "../bulkheads";
import { DECK, LIFT } from "../layout";
import type { DeckPaint } from "../paint";
import { useStationMesh, type StationPiece } from "./models";

/** Floor tiles are 2 m square and 0.15 m thick, their tops at y = 0. */
const TILE = 2;
const TILE_H = 0.15;
/** A Kenney floor piece is 0.3 units thick. */
const TILE_SCALE_Y = TILE_H / 0.3;
/** Bulkheads keep the kit's 0.3 m thickness. */
const WALL_DEPTH_SCALE = 1;

interface Placement {
  position: [number, number, number];
  rotY: number;
  scale: [number, number, number];
}

/** One Kenney piece placed many times as a single instanced mesh, tinted toward the deck's paint. */
function KitInstances({ piece, at, tint }: { piece: StationPiece; at: Placement[]; tint: string }) {
  const { geometry, material } = useStationMesh(piece);
  const ref = useRef<InstancedMesh>(null);
  const tinted = useMemo(() => {
    const m = material.clone();
    m.color = new Color(tint);
    return m;
  }, [material, tint]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    at.forEach((p, i) => {
      rotation.setFromEuler(new Euler(0, p.rotY, 0));
      matrix.compose(new Vector3(...p.position), rotation, new Vector3(...p.scale));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [at]);

  useLayoutEffect(() => () => tinted.dispose(), [tinted]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, tinted, at.length]}
      castShadow={piece !== "floor" && piece !== "floor-panel"}
      receiveShadow
    />
  );
}

const wallAt = (m: Module): Placement => ({
  position: [m.x, 0, m.z],
  rotY: m.rotY,
  scale: [m.width, WALL_H, WALL_DEPTH_SCALE],
});

/** Floor tiles: plain plates, with panelled ones down the aisle, the lanes and in front of the lift. */
function floorPlan(): Record<"floor" | "floor-panel", Placement[]> {
  const plan = { floor: [] as Placement[], "floor-panel": [] as Placement[] };
  for (let x = DECK.minX + TILE / 2; x < DECK.maxX; x += TILE) {
    for (let z = DECK.minZ + TILE / 2; z < DECK.maxZ; z += TILE) {
      const aisle = Math.abs(z) < TILE / 2;
      const lift = Math.abs(x - LIFT.x) < TILE && z < DECK.minZ + TILE;
      plan[aisle || lift ? "floor-panel" : "floor"].push({
        position: [x, -TILE_H, z],
        rotY: 0,
        scale: [TILE, TILE_SCALE_Y, TILE],
      });
    }
  }
  return plan;
}

/** Light a colour toward white: the kit's textures are multiplied by it. */
function lighten(hex: string, by: number): string {
  return `#${new Color(hex).lerp(new Color("#ffffff"), by).getHexString()}`;
}

/** The deck's shell from the Kenney Space Station Kit: bulkheads with door frames and windows, and a tiled floor. */
export function Shell({ paint }: { paint: DeckPaint }) {
  const walls = useMemo(() => {
    const by = new Map<StationPiece, Placement[]>();
    for (const m of bulkheads()) by.set(m.piece, [...(by.get(m.piece) ?? []), wallAt(m)]);
    return [...by];
  }, []);
  const floor = useMemo(floorPlan, []);
  // Each deck keeps its own colour, as a light wash over the kit's lavender.
  const wallTint = lighten(paint.wall, 0.55);
  const floorTint = lighten(paint.floor, 0.12);

  return (
    <group>
      {walls.map(([piece, at]) => (
        <KitInstances key={piece} piece={piece} at={at} tint={wallTint} />
      ))}
      <KitInstances piece="floor" at={floor.floor} tint={floorTint} />
      <KitInstances piece="floor-panel" at={floor["floor-panel"]} tint={floorTint} />
    </group>
  );
}
