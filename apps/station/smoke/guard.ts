import { existsSync } from "node:fs";
import { createRequire } from "node:module";

/** Why the harness can't start when the PTY host was never built. */
export const BUILD_PTYHOST = "build ptyhost: vp pack in packages/ptyhost";

/** The smoke drives the real claude: only `vp run smoke:real` (which sets MOTHERSHIP_SMOKE=1) may start it. */
export function requireSmokeEnv(env: NodeJS.ProcessEnv = process.env): void {
  if (env.MOTHERSHIP_SMOKE !== "1") throw new Error("Run with vp run smoke:real");
}

/** The model every claude run in the smoke uses: $SMOKE_MODEL, else haiku. */
export function smokeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.SMOKE_MODEL || "haiku";
}

/** Whether the built PTY host the launcher starts by default exists. */
export function ptyhostBuilt(): boolean {
  try {
    return existsSync(createRequire(import.meta.url).resolve("@mothership/ptyhost/bin"));
  } catch {
    return false;
  }
}
