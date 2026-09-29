import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npx serve dist -l 4173",
    url: "http://localhost:4173",
    reuseExistingServer: true,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", use: { viewport: { width: 900, height: 700 } } },
    { name: "phone-landscape", use: { viewport: { width: 844, height: 390 }, hasTouch: true } },
  ],
});
