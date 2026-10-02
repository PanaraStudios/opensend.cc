import { afterEach, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it("calling tools use the real SDK, expose settings and preserve request idempotency", async () => {
  const f = await connectClient()
  try {
    const tools = (await f.client.listTools()).tools
    expect(
      tools.find((t) => t.name === "list-whatsapp-calls")?.annotations
        ?.readOnlyHint
    ).toBe(true)
    expect(
      tools.find((t) => t.name === "terminate-whatsapp-call")?.annotations
        ?.destructiveHint
    ).toBe(true)
    const fetcher = vi.fn(async () =>
      Response.json({ id: "call", success: true })
    )
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name: "connect-whatsapp-call",
      arguments: {
        recipient: "US.42",
        route: "gateway",
        idempotencyKey: "once",
      },
    })
    expect(result.isError).not.toBe(true)
    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe("https://api.opensend.test/whatsapp/calls")
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: "US.42",
      route: "gateway",
    })
    expect(new Headers(init.headers).get("idempotency-key")).toBe("once")
    const updated = await f.client.callTool({
      name: "update-whatsapp-calling",
      arguments: {
        id: "number/1",
        handling_mode: "api",
        calling: { status: "ENABLED", call_hours: { status: "DISABLED" } },
      },
    })
    expect(updated.isError).not.toBe(true)
    expect((fetcher.mock.calls.at(-1) as unknown as [string])[0]).toBe(
      "https://api.opensend.test/whatsapp/phone-numbers/number%2F1/calling"
    )
    const count = fetcher.mock.calls.length
    expect(
      (
        await f.client.callTool({
          name: "request-whatsapp-call-permission",
          arguments: { recipient: "US.42" },
        })
      ).isError
    ).toBe(true)
    expect(
      (
        await f.client.callTool({
          name: "list-whatsapp-calls",
          arguments: { after: "a", before: "b" },
        })
      ).isError
    ).toBe(true)
    expect(fetcher.mock.calls).toHaveLength(count)
  } finally {
    await f.close()
  }
})
