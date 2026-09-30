import { describe, expect, it } from "vitest"
import { parseArgs, resolveConfig } from "../src/cli/index.js"
import { fakeKey, baseUrl } from "./helpers/client.js"
describe("self-hosted configuration", () => {
  it.each([{ flags: [] }, { flags: ["--http"] }])(
    "requires an origin for $flags",
    ({ flags }) => {
      expect(
        resolveConfig(parseArgs(flags), { OPENSEND_API_KEY: fakeKey })
      ).toEqual({
        ok: false,
        error: expect.stringContaining("OPENSEND_BASE_URL"),
      })
    }
  )
  it("ignores legacy environment variables", () => {
    expect(
      resolveConfig(parseArgs([]), {
        RESEND_API_KEY: fakeKey,
        RESEND_BASE_URL: baseUrl,
      }).ok
    ).toBe(false)
    expect(
      resolveConfig(parseArgs(["--key", fakeKey]), { RESEND_BASE_URL: baseUrl })
        .ok
    ).toBe(false)
  })
  it("prefers command line origin and key", () => {
    const result = resolveConfig(
      parseArgs(["--key", fakeKey, "--base-url", baseUrl]),
      {
        OPENSEND_API_KEY: "os_test1111111111111111111111111111",
        OPENSEND_BASE_URL: "https://other.example.com",
      }
    )
    expect(result).toMatchObject({
      ok: true,
      config: { apiKey: fakeKey, baseUrl },
    })
  })
  it.each([
    "",
    "ftp://example.com",
    "https://u:p@example.com",
    "https://example.com/path",
    "https://example.com?x=y",
  ])("rejects invalid origin %s", (origin) => {
    expect(
      resolveConfig(parseArgs(["--http", "--base-url", origin]), {}).ok
    ).toBe(false)
  })
})
