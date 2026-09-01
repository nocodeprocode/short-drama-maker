import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
    environment: "node",
    // Media tests spawn real ffmpeg/python and contend for CPU when files run in parallel.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
