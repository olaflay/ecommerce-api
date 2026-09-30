import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 45000,
    hookTimeout: 45000,
    globals: true,
    fileParallelism: false,
  },
});

