import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    environment: "edge-runtime",
    // Unit tests must never report synthetic installations to the collector.
    // telemetry.test.ts explicitly enables sharing and mocks fetch.
    env: { OPENSEND_TELEMETRY: "0" },
    include: ["convex/**/*.test.ts"],
    // Fan-out and pagination tests run hundreds of mutations; the default 5s
    // fails them on a loaded machine rather than on a real bug.
    testTimeout: 30_000,
  },
})
