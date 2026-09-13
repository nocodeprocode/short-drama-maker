import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts", "workers/**/*.test.ts"],
    environment: "node",
    // Media tests spawn real ffmpeg/python and contend for CPU when files run in parallel.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
