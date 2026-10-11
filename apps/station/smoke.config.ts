import { defineConfig } from "vite-plus";

/** `vp run smoke:real`: the real-claude smoke, one claude at a time. */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["smoke/real.smoke.ts"],
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    // Each check has its own 120 s limit; a group runs several of them.
    testTimeout: 30 * 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 120_000,
  },
});
