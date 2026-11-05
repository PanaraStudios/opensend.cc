import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    environment: "edge-runtime",
    include: ["src/**/*.test.ts"],
    maxWorkers: 2,
    // Turbo runs this beside the app build and backend suite; the default 5s
    // fails retry/workpool tests on a loaded machine rather than on a real bug.
    testTimeout: 30_000,
  },
})
