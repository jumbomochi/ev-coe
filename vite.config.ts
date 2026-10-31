import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The end-to-end build (EVCOE_DATA=fixture) reads a frozen data snapshot so its expected
// figures never move when LTA publishes new results (eng review D20).
const dataDir = process.env.EVCOE_DATA === "fixture" ? "./e2e/fixtures/data" : "./data";

export default defineConfig({
  // Served from https://<user>.github.io/ev-coe/ on GitHub Pages.
  base: "./",
  resolve: {
    alias: { "@data": fileURLToPath(new URL(dataDir, import.meta.url)) },
  },
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
