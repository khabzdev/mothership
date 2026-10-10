import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  CAMERA_FAR,
  CAMERA_ROAM,
  EARTH,
  MOON,
  PLANET_TEXTURES,
  STARS,
  SUN,
  SUN_DIRECTION,
  SUN_LIGHT,
  type Body,
} from "../../src/features/world/sky";

const length = (v: readonly number[]) => Math.hypot(...v);
const dot = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
/** A body's angular radius seen from the sky's centre (the camera), in degrees. */
const angular = (b: Body, scale = 1) =>
  (Math.asin((b.radius * scale) / b.distance) * 180) / Math.PI;
/** Earth's outermost shell (the atmosphere) relative to its radius. */
const EARTH_SHELL = EARTH.atmosphere;
const apart = (a: Body, b: Body) =>
  (Math.acos(Math.min(1, dot(a.direction, b.direction))) * 180) / Math.PI;

describe("the sun", () => {
  test("its direction is normalized and points at the deck's directional light", () => {
    expect(length(SUN_DIRECTION)).toBeCloseTo(1, 9);
    const light = SUN_LIGHT.map((x) => x / length(SUN_LIGHT));
    SUN_DIRECTION.forEach((x, i) => expect(x).toBeCloseTo(light[i], 9));
    expect(SUN.direction).toBe(SUN_DIRECTION);
  });

  test("the deck's light and the sky both read the one sun", () => {
    const read = (file: string) =>
      readFileSync(new URL(`../../src/features/world/scene/${file}`, import.meta.url), "utf8");
    expect(read("Atmosphere.tsx")).toMatch(/position=\{SUN_LIGHT\}/);
    expect(read("Sky.tsx")).toContain("SUN_DIRECTION");
  });
});

describe("sky placement", () => {
  const bodies = { EARTH, MOON, SUN };

  test("every direction is a unit vector", () => {
    for (const b of Object.values(bodies)) expect(length(b.direction)).toBeCloseTo(1, 9);
  });

  test("every body, with its shells, stays inside the camera's far plane", () => {
    for (const b of Object.values(bodies)) {
      expect(b.distance + b.radius * EARTH_SHELL).toBeLessThan(CAMERA_FAR);
      expect(b.distance - b.radius * EARTH_SHELL).toBeGreaterThan(CAMERA_ROAM);
    }
  });

  test("Earth fills the lower sky beyond the north side as a big curved horizon", () => {
    expect(angular(EARTH)).toBeGreaterThanOrEqual(25);
    // Its centre is below the horizon, north of the deck, and its top limb reaches about eye level.
    expect(EARTH.direction[1]).toBeLessThan(0);
    expect(EARTH.direction[2]).toBeLessThan(0);
    const top = (Math.asin(EARTH.direction[1]) * 180) / Math.PI + angular(EARTH);
    expect(top).toBeGreaterThan(-6);
    expect(top).toBeLessThan(6);
  });

  test("the Sun and the Moon stand clear of Earth's disc (and its atmosphere)", () => {
    const earth = angular(EARTH, EARTH_SHELL);
    expect(apart(SUN, EARTH)).toBeGreaterThan(earth + angular(SUN) + 5);
    expect(apart(MOON, EARTH)).toBeGreaterThan(earth + angular(MOON) + 5);
    expect(apart(SUN, MOON)).toBeGreaterThan(angular(SUN) + angular(MOON) + 5);
  });

  test("the Moon is a small disc and the Sun a smaller one", () => {
    expect(angular(MOON)).toBeGreaterThan(1.5);
    expect(angular(MOON)).toBeLessThan(5);
    expect(angular(SUN)).toBeLessThan(angular(MOON));
  });

  test("stars sit behind every visible bit of the bodies, wherever the camera roams", () => {
    // The farthest point of a sphere the camera can see is where its line of sight grazes the
    // limb; stars nearer than that would draw over the body.
    for (const b of Object.values(bodies)) {
      const shell = b.radius * EARTH_SHELL;
      expect(STARS.radius - CAMERA_ROAM).toBeGreaterThan(Math.sqrt(b.distance ** 2 - shell ** 2));
    }
    expect(STARS.radius + STARS.depth + CAMERA_ROAM).toBeLessThan(CAMERA_FAR);
  });
});

describe("planet textures", () => {
  const script = readFileSync(new URL("../../scripts/fetch-assets.mjs", import.meta.url), "utf8");

  test("are the four three.js planet maps, fetched by the assets script", () => {
    const names = Object.values(PLANET_TEXTURES).map((url) => url.split("/").pop());
    expect(new Set(names)).toEqual(
      new Set([
        "earth_atmos_2048.jpg",
        "earth_clouds_1024.png",
        "earth_lights_2048.png",
        "moon_1024.jpg",
      ]),
    );
    for (const name of names) expect(script).toContain(`"${name}"`);
  });

  test("are on disk where the sky loads them", () => {
    for (const url of Object.values(PLANET_TEXTURES)) {
      expect(
        existsSync(new URL(`../../public${url}`, import.meta.url)),
        `${url} missing: run vp run assets`,
      ).toBe(true);
    }
  });

  test("are not committed", () => {
    const ignore = readFileSync(new URL("../../.gitignore", import.meta.url), "utf8");
    expect(ignore).toMatch(/^public\/textures\/\*$/m);
  });
});
