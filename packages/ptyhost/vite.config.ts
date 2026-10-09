import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/bin.ts"],
    dts: true,
    exports: true,
  },
  test: {
    testTimeout: 15_000,
  },
});
