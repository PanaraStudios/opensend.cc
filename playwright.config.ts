import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `${process.env.OPENSEND_TEST_RESULTS ?? "test-results"}/html`,
      },
    ],
  ],
  outputDir: `${process.env.OPENSEND_TEST_RESULTS ?? "test-results"}/browser`,
  use: {
    baseURL: process.env.OPENSEND_BASE_URL ?? "http://localhost:3400",
    browserName: (process.env.OPENSEND_BROWSER ?? "chromium") as
      "chromium" | "firefox" | "webkit",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--host-resolver-rules=MAP host.docker.internal 127.0.0.1"],
    },
  },
})
