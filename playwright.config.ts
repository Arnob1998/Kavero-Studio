import { defineConfig, devices } from "@playwright/test";

const smokePort = process.env.PLAYWRIGHT_PORT ?? "3210";
const smokeBaseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${smokePort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: smokeBaseURL,
    trace: "on-first-retry",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `pnpm dev:ui --hostname 127.0.0.1 --port ${smokePort}`,
        url: smokeBaseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
