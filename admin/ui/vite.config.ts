import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  plugins: [react()],
  build: { outDir: path.resolve(import.meta.dirname, "../dist"), emptyOutDir: true },
  server: { port: 5190, proxy: { "/api": "http://localhost:8787" } },
});
