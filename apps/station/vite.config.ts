import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  plugins: lazyPlugins(() => [devtools(), nitro(), tanstackStart(), viteReact()]),
});
