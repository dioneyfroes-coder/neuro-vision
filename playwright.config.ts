import { defineConfig } from "@playwright/test";

const PORTA = 3210;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORTA}`,
    headless: true,
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  webServer: {
    command: "npm run build && node dist/server.js",
    url: `http://127.0.0.1:${PORTA}/api/health`,
    env: { PORT: String(PORTA), HOST: "127.0.0.1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
