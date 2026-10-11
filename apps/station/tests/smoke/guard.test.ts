import { configDefaults } from "vite-plus";
import { describe, expect, test } from "vite-plus/test";
import { requireSmokeEnv, smokeModel } from "../../smoke/guard.ts";
import smokeConfig from "../../smoke.config.ts";
import viteConfig from "../../vite.config.ts";

describe("requireSmokeEnv", () => {
  test("refuses to run without SPACESHIP_SMOKE=1", () => {
    expect(() => requireSmokeEnv({})).toThrow("Run with vp run smoke:real");
    expect(() => requireSmokeEnv({ SPACESHIP_SMOKE: "0" })).toThrow("Run with vp run smoke:real");
  });

  test("runs with SPACESHIP_SMOKE=1", () => {
    expect(() => requireSmokeEnv({ SPACESHIP_SMOKE: "1" })).not.toThrow();
  });
});

describe("smokeModel", () => {
  test("defaults to haiku", () => {
    expect(smokeModel({})).toBe("haiku");
    expect(smokeModel({ SMOKE_MODEL: "" })).toBe("haiku");
    expect(smokeModel({ SMOKE_MODEL: "sonnet" })).toBe("sonnet");
  });
});

describe("test configs", () => {
  test("plain vp test never collects the smoke suite and keeps vitest's default excludes", () => {
    const exclude = viteConfig.test?.exclude ?? [];
    expect(exclude).toContain("smoke/**");
    for (const pattern of configDefaults.exclude) expect(exclude).toContain(pattern);
  });

  test("the smoke config runs only the smoke entry, one file at a time", () => {
    expect(smokeConfig.test?.include).toEqual(["smoke/real.smoke.ts"]);
    expect(smokeConfig.test?.fileParallelism).toBe(false);
    expect(smokeConfig.test?.testTimeout).toBeGreaterThanOrEqual(120_000);
  });
});
