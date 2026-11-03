import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

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
  ],
  webServer: {
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
});
