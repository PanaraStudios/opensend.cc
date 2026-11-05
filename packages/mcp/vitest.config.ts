import { defineConfig } from "vitest/config"
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Turbo runs this beside the app build and backend suite; the stdio smoke
    // tests spawn the CLI and miss the default 5s on a loaded machine.
    testTimeout: 30_000,
  },
})
