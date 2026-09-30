import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    environment: "edge-runtime",
    maxWorkers: 2,
    include: ["convex/**/*.test.ts"],
    // Fan-out and pagination tests run hundreds of mutations; the default 5s
    // fails them on a loaded machine rather than on a real bug.
    testTimeout: 30_000,
  },
})
