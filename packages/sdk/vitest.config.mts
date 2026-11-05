import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['vitest.setup.mts'],
    // Turbo runs this beside the app build and backend suite.
    testTimeout: 30_000,
  },
});
