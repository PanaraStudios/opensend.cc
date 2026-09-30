import type { Opensend } from "@opensendcc/sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runStdio } from "../../src/transports/stdio.js"

const { mockServeStdio } = vi.hoisted(() => ({
  mockServeStdio: vi.fn(
    (
      _factory: () => unknown,
      _options: { onerror: (error: Error) => void }
    ) => ({
      close: vi.fn().mockResolvedValue(undefined),
    })
  ),
}))

vi.mock("../../src/server.js", () => ({
  createMcpServer: vi.fn(
    (
      _factory: () => unknown,
      _options: { onerror: (error: Error) => void }
    ) => ({ mock: "server" })
  ),
}))

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: mockServeStdio,
}))

describe("runStdio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves with legacy: "serve" so old clients are unaffected', async () => {
    const resend = {} as Opensend
    await runStdio(resend, { replierEmailAddresses: [] })

    expect(mockServeStdio).toHaveBeenCalledTimes(1)
    const [, options] = mockServeStdio.mock.calls[0]
    expect(options).toMatchObject({ legacy: "serve" })
  })

  it("creates server via the factory passed to serveStdio", async () => {
    const resend = {} as Opensend
    await runStdio(resend, { replierEmailAddresses: [] })
    const { createMcpServer } = await import("../../src/server.js")

    const [factory] = mockServeStdio.mock.calls[0]
    factory()

    expect(createMcpServer).toHaveBeenCalledWith(resend, {
      senderEmailAddress: undefined,
      replierEmailAddresses: [],
    })
  })

  it("passes sender and repliers to server", async () => {
    const resend = {} as Opensend
    await runStdio(resend, {
      senderEmailAddress: "x@r.dev",
      replierEmailAddresses: ["a@x.com", "b@x.com"],
    })
    const { createMcpServer } = await import("../../src/server.js")
    const [factory] = mockServeStdio.mock.calls[0]
    factory()

    expect(createMcpServer).toHaveBeenCalledWith(resend, {
      senderEmailAddress: "x@r.dev",
      replierEmailAddresses: ["a@x.com", "b@x.com"],
    })
  })

  it("wires connection errors to onerror instead of a rejected promise", async () => {
    const resend = {} as Opensend
    await runStdio(resend, { replierEmailAddresses: [] })

    const [, options] = mockServeStdio.mock.calls[0]
    expect(() => options.onerror(new Error("boom"))).not.toThrow()
  })
})
