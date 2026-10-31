import { defineConfig } from "vitest/config";

export default defineConfig({
  // Served from https://<user>.github.io/ev-coe/ on GitHub Pages.
  base: "./",
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
