import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { SPACE_PIECES } from "../../src/features/world/scene/models.ts";

const dir = new URL("../../public/models/space-base/", import.meta.url);

describe("space base assets", () => {
  test("every space piece has its gltf, bin and the texture", () => {
    expect(SPACE_PIECES).toHaveLength(37);
    for (const name of SPACE_PIECES) {
      const gltf = new URL(`${name}.gltf`, dir);
      expect(existsSync(gltf), `${name}.gltf`).toBe(true);
      const json = JSON.parse(readFileSync(gltf, "utf8")) as { buffers: { uri: string }[] };
      expect(existsSync(new URL(json.buffers[0].uri, dir)), `${name} bin`).toBe(true);
    }
    expect(existsSync(new URL("spacebits_texture.png", dir))).toBe(true);
    expect(existsSync(new URL("License.txt", dir))).toBe(true);
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
