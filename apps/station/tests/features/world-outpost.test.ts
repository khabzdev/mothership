import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";
import { DECK, GARAGE_DOOR, LAUNCH_PAD, SHIP_PAD } from "../../src/features/world/layout";
import { ISLAND, TILE } from "../../src/features/world/island";
import { GARAGE, OUTPOST, OUTPOST_SCALE, PAD_CLEARINGS } from "../../src/features/world/outpost";
import type { Placement } from "../../src/features/world/placement";
import { SPACE_PIECES } from "../../src/features/world/scene/models";

const WALL_MARGIN = 0.6;
/** How far a piece may overhang toward the slope rim. */
const OVERHANG = 0.5;
const EPS = 1e-6;

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A piece's native footprint, from its glTF's POSITION accessor bounds (so it can't drift). */
const native = new Map<string, Box>();
function nativeBox(piece: string): Box {
  let box = native.get(piece);
  if (box) return box;
  const url = new URL(`../../public/models/space-base/${piece}.gltf`, import.meta.url);
  const gltf = JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as {
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
    accessors: { min: number[]; max: number[] }[];
  };
  box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const mesh of gltf.meshes)
    for (const prim of mesh.primitives) {
      const a = gltf.accessors[prim.attributes.POSITION];
      box.minX = Math.min(box.minX, a.min[0]);
      box.maxX = Math.max(box.maxX, a.max[0]);
      box.minZ = Math.min(box.minZ, a.min[2]);
      box.maxZ = Math.max(box.maxZ, a.max[2]);
    }
  native.set(piece, box);
  return box;
}

/** The axis-aligned footprint of a placed piece (its native box turned about Y, scaled, moved). */
function footprint(piece: string, p: Placement): Box {
  const n = nativeBox(piece);
  const c = Math.cos(p.rotY);
  const s = Math.sin(p.rotY);
  const out: Box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const x of [n.minX, n.maxX])
    for (const z of [n.minZ, n.maxZ]) {
      const wx = p.position[0] + p.scale * (x * c + z * s);
      const wz = p.position[2] + p.scale * (-x * s + z * c);
      out.minX = Math.min(out.minX, wx);
      out.maxX = Math.max(out.maxX, wx);
      out.minZ = Math.min(out.minZ, wz);
      out.maxZ = Math.max(out.maxZ, wz);
    }
  return out;
}

const pieces = () => [
  ...Object.entries(OUTPOST).flatMap(([piece, at]) =>
    at.map((placement) => ({ piece, placement, box: footprint(piece, placement) })),
  ),
  { piece: "basemodule_garage", placement: GARAGE, box: footprint("basemodule_garage", GARAGE) },
];
const label = (e: { piece: string; placement: Placement }) =>
  `${e.piece} at ${e.placement.position[0]}, ${e.placement.position[2]}`;

describe("the outpost", () => {
  test("is drawn at 2x", () => {
    expect(OUTPOST_SCALE).toBe(2);
  });

  test("every outpost footprint is outside the play area", () => {
    for (const e of pieces()) {
      const [x, , z] = e.placement.position;
      if (e.piece === "lights") {
        // Just outside the walking clamp, within a metre of it.
        const out = Math.max(
          Math.abs(x) - (DECK.maxX - WALL_MARGIN),
          Math.abs(z) - (DECK.maxZ - WALL_MARGIN),
        );
        expect(out, label(e)).toBeGreaterThan(0);
        expect(out, label(e)).toBeLessThanOrEqual(1);
        continue;
      }
      const b = e.box;
      const outside =
        b.maxX <= DECK.minX - 0.3 ||
        b.minX >= DECK.maxX + 0.3 ||
        b.maxZ <= DECK.minZ - 0.3 ||
        b.minZ >= DECK.maxZ + 0.3;
      expect(outside, label(e)).toBe(true);
    }
  });

  test("every outpost footprint stands on the flat ring, overhanging the rim by at most 0.5 m", () => {
    for (const e of pieces()) {
      expect(e.box.minX, label(e)).toBeGreaterThanOrEqual(ISLAND.minX + TILE - OVERHANG);
      expect(e.box.maxX, label(e)).toBeLessThanOrEqual(ISLAND.maxX - TILE + OVERHANG);
      expect(e.box.minZ, label(e)).toBeGreaterThanOrEqual(ISLAND.minZ + TILE - OVERHANG);
      expect(e.box.maxZ, label(e)).toBeLessThanOrEqual(ISLAND.maxZ - TILE + OVERHANG);
    }
  });

  test("outpost footprints keep the pad clearings free", () => {
    expect(PAD_CLEARINGS).toEqual([
      { ...SHIP_PAD, r: 4 },
      { ...LAUNCH_PAD, r: 4 },
    ]);
    for (const e of pieces())
      for (const c of PAD_CLEARINGS) {
        const nx = Math.min(e.box.maxX, Math.max(e.box.minX, c.x));
        const nz = Math.min(e.box.maxZ, Math.max(e.box.minZ, c.z));
        expect(
          Math.hypot(nx - c.x, nz - c.z),
          `${label(e)} near ${c.x}, ${c.z}`,
        ).toBeGreaterThanOrEqual(c.r);
      }
  });

  test("no two outpost footprints overlap", () => {
    // Roof panels sit on top of their module, so they are not on the ground.
    const all = pieces().filter((e) => e.piece !== "roofmodule_solarpanels");
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i].box;
        const b = all[j].box;
        // A tunnel plugs into its modules' doors, so it may reach into them a little.
        const slack =
          all[i].piece === "tunnel_straight_A" || all[j].piece === "tunnel_straight_A" ? 0.15 : EPS;
        const apart =
          a.maxX <= b.minX + slack ||
          b.maxX <= a.minX + slack ||
          a.maxZ <= b.minZ + slack ||
          b.maxZ <= a.minZ + slack;
        expect(apart, `${label(all[i])} vs ${label(all[j])}`).toBe(true);
      }
  });

  test("outpost pieces are known assets", () => {
    for (const piece of Object.keys(OUTPOST)) expect(SPACE_PIECES).toContain(piece);
    expect(SPACE_PIECES).toContain("basemodule_garage");
  });

  test("the garage stands on its own (its door moves), facing the deck", () => {
    expect(OUTPOST.basemodule_garage).toBeUndefined();
    expect(GARAGE.rotY).toBeCloseTo(Math.PI);
    expect(GARAGE.position[2]).toBeGreaterThan(DECK.maxZ);
  });

  test("the garage door spot is within 1.5 m of the garage's door side", () => {
    const front = footprint("basemodule_garage", GARAGE).minZ;
    expect(front).toBeGreaterThan(GARAGE_DOOR.z);
    expect(front - GARAGE_DOOR.z).toBeLessThanOrEqual(1.5);
    expect(GARAGE_DOOR.x).toBeCloseTo(GARAGE.position[0]);
  });
});
