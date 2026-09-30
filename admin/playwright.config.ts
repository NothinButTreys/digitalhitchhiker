import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:8799", extraHTTPHeaders: { "x-dev-email": "owner@example.com" } },
  webServer: {
    command:
      "node e2e/fixtures/make-fixtures.mjs && npm run build:ui && rm -rf .wrangler/e2e && wrangler d1 migrations apply digital-hitchhiker --local --persist-to .wrangler/e2e && wrangler dev --local --port 8799 --persist-to .wrangler/e2e --var ENVIRONMENT:development --var AUTH_MODE:dev --var OWNER_EMAIL:owner@example.com",
    url: "http://localhost:8799/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "phone", use: { viewport: { width: 375, height: 812 }, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
