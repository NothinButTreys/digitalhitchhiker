import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            ENVIRONMENT: "test",
            AUTH_MODE: "dev",
            OWNER_EMAIL: "owner@example.com",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
    },
  };
});
