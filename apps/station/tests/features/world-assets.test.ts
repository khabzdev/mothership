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
