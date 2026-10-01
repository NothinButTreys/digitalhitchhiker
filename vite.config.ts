import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const SET_FILE = /\/content\/sets\/[^/]+\.json$/;

/**
 * Drops each photo's `source` (the original's file name) from the content
 * files as they are bundled, so no original file name reaches the browser.
 */
function stripPhotoSources(): Plugin {
  return {
    name: "dh:strip-photo-sources",
    enforce: "pre",
    transform(code, id) {
      if (!SET_FILE.test(id.split("?")[0] ?? id)) return null;
      const set = JSON.parse(code) as { photos?: Record<string, unknown>[] };
      for (const photo of set.photos ?? []) delete photo.source;
      return { code: JSON.stringify(set), map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripPhotoSources(), react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
