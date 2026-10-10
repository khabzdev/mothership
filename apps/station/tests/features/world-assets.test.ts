import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { islandPlan } from "../../src/features/world/island.ts";
import { OUTPOST } from "../../src/features/world/outpost.ts";
import {
  GARAGE_PIECE,
  LANDER_PIECE,
  LANDING_PAD_PIECE,
  SPACE_PIECES,
} from "../../src/features/world/scene/models.ts";

const dir = new URL("../../public/models/space-base/", import.meta.url);

describe("space base assets", () => {
  test("every space piece has its gltf, bin and the texture", () => {
    for (const name of SPACE_PIECES) {
      const gltf = new URL(`${name}.gltf`, dir);
      expect(existsSync(gltf), `${name}.gltf missing: run vp run assets`).toBe(true);
      const json = JSON.parse(readFileSync(gltf, "utf8")) as { buffers: { uri: string }[] };
      expect(
        existsSync(new URL(json.buffers[0].uri, dir)),
        `${name} bin missing: run vp run assets`,
      ).toBe(true);
    }
    expect(
      existsSync(new URL("spacebits_texture.png", dir)),
      "texture missing: run vp run assets",
    ).toBe(true);
    expect(existsSync(new URL("License.txt", dir)), "License.txt missing: run vp run assets").toBe(
      true,
    );
  });
});

describe("space piece list", () => {
  test("is exactly the pieces the scene draws", () => {
    const drawn = new Set([
      ...Object.keys(OUTPOST),
      GARAGE_PIECE,
      LANDER_PIECE,
      LANDING_PAD_PIECE,
      ...Object.keys(islandPlan()),
    ]);
    expect(new Set(SPACE_PIECES)).toEqual(drawn);
    expect(new Set(SPACE_PIECES).size).toBe(SPACE_PIECES.length);
  });
});

describe("no Kenney station kit", () => {
  test("its models and loaders are gone", () => {
    expect(existsSync(new URL("../../public/models/station", import.meta.url))).toBe(false);
    const models = readFileSync(
      new URL("../../src/features/world/scene/models.ts", import.meta.url),
      "utf8",
    );
    expect(models).not.toMatch(/station|kenney/i);
  });

  test("unused landers and pads are not fetched", () => {
    const script = readFileSync(new URL("../../scripts/fetch-assets.mjs", import.meta.url), "utf8");
    expect(script).not.toContain('"landingpad_small"');
    expect(script).not.toContain('"lander_B"');
    expect(SPACE_PIECES).not.toContain("landingpad_small");
    expect(SPACE_PIECES).not.toContain("lander_B");
  });
});

describe("no office furniture in space", () => {
  test("only the console chair and table are fetched from the furniture pack", () => {
    const script = readFileSync(new URL("../../scripts/fetch-assets.mjs", import.meta.url), "utf8");
    const furniture = script.slice(script.indexOf("const FURNITURE = {"));
    const from = furniture.indexOf("models: [");
    const models = furniture.slice(from, furniture.indexOf("],", from));
    const names = [...models.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(["chair_A", "table_medium_long"]);
    expect(furniture).toContain('"furniturebits_texture.png"');
  });

  test("the deck places no furniture", () => {
    const deck = readFileSync(
      new URL("../../src/features/world/scene/Deck.tsx", import.meta.url),
      "utf8",
    );
    expect(deck).not.toContain("<Furniture");
    expect(deck).not.toContain("Furniture");
  });
});
