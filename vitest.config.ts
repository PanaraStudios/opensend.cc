import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

/* Web component tests (React rendered to static markup with Convex mocked).
   Backend tests live in packages/backend; pure logic tests run under tsx. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "edge-runtime",
    env: { OPENSEND_TELEMETRY: "0" },
    include: ["components/**/*.test.ts"],
    testTimeout: 30_000,
  },
})
