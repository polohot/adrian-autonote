import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// The fake AI provider used by e2e/settings.spec.ts. Not PORT + 1: in this WSL setup that port is redirected to the app.
const FAKE_AI_PORT = 3199;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone-dark", use: { ...devices["Pixel 7"], colorScheme: "dark" } },
    { name: "desktop-dark", use: { ...devices["Desktop Chrome"], colorScheme: "dark" } },
  ],
  webServer: [
    {
      // Fresh database for every run; the build is done by `npm run test:e2e` beforehand.
      command: "rm -rf .e2e-data && node --disable-warning=ExperimentalWarning apps/server/dist/index.js",
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      env: {
        PORT: String(PORT),
        AUTONOTE_DATA_DIR: ".e2e-data",
        AUTONOTE_LOGIN_LIMIT: "1000",
      },
    },
    {
      command: "node e2e/fake-ai.mjs",
      url: `http://127.0.0.1:${FAKE_AI_PORT}/health`,
      reuseExistingServer: false,
      env: { FAKE_AI_PORT: String(FAKE_AI_PORT) },
    },
  ],
});
