import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDefaults, defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  // App plugins start servers and devtools; unit tests don't need them.
  plugins: lazyPlugins(() =>
    process.env.VITEST
      ? []
      : [
          // Source injection adds data-* props to every JSX element, which R3F objects reject.
          devtools({ injectSource: { enabled: false } }),
          nitro({
            features: { websocket: true },
            routes: { "/_ws": "./src/shared/realtime/socket.server.ts" },
            plugins: ["./src/app/station.plugin.ts"],
          }),
          tailwindcss(),
          tanstackStart(),
          viteReact(),
        ],
  ),
  // The real-claude smoke runs only through `vp run smoke:real` (smoke.config.ts).
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "smoke/**"],
    // Never the real ~/.spaceship: a test that opens the station's home gets a throwaway one.
    env: { SPACESHIP_HOME: join(tmpdir(), `spaceship-test-home-${process.pid}`) },
  },
});
