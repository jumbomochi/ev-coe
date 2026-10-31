import { defineConfig, devices } from "@playwright/test";

// Builds the site against the frozen data in e2e/fixtures/data and serves it locally (eng review D15/D20).
export default defineConfig({
  testDir: "e2e",
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4174", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4174 --strictPort",
    env: { EVCOE_DATA: "fixture" },
    url: "http://localhost:4174",
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
