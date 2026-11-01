import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "public-desktop", testMatch: "public.spec.ts", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "public-mobile", testMatch: "public.spec.ts", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "auth-desktop", testMatch: ["auth.spec.ts", "conversation.spec.ts", "reminders.spec.ts", "voice.spec.ts", "tasks.spec.ts", "privacy.spec.ts", "personal-version.spec.ts"], use: { viewport: { width: 1440, height: 1000 } } },
    { name: "auth-mobile", testMatch: ["auth.spec.ts", "conversation.spec.ts", "reminders.spec.ts", "voice.spec.ts", "tasks.spec.ts", "privacy.spec.ts", "personal-version.spec.ts"], use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: "node_modules/.bin/next start --hostname 127.0.0.1 --port 3100",
    env: { JARVIS_MOCK_ONLY: "1", APP_ORIGIN: "http://127.0.0.1:3100" },
    url: "http://127.0.0.1:3100/sign-in", reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2000 },
    timeout: 30_000,
    stdout: "ignore", stderr: "pipe",
  },
});
