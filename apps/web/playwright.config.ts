import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const e2eDataDir =
  process.env.UZINA_E2E_DATA_DIR ??
  path.join(os.tmpdir(), `uzina-e2e-s6-${Date.now()}`);

process.env.UZINA_E2E_DATA_DIR = e2eDataDir;
fs.mkdirSync(e2eDataDir, { recursive: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3046",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm exec next start -p 3046 -H 127.0.0.1",
    url: "http://127.0.0.1:3046/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      UZINA_DATA_DIR: e2eDataDir,
      BETTER_AUTH_URL: "http://127.0.0.1:3046",
      NODE_ENV: "production",
    },
  },
});
