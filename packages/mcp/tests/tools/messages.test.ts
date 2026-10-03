import { afterEach, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it.each(["email", "whatsapp", "messenger", "instagram"])(
  "send_message sends %s through the SDK with idempotency",
  async (channel) => {
    const f = await connectClient("fixture-credential")
    try {
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json({ id: "message" })
      )
      vi.stubGlobal("fetch", fetcher)
      const body = {
        channel,
        to: "recipient",
        text: "Hello",
        tags: [{ name: "flow", value: "unified" }],
      }
      const result = await f.client.callTool({
        name: "send_message",
        arguments: { ...body, idempotencyKey: "retry-message" },
      })
      expect(result.isError).not.toBe(true)
      const [url, init] = fetcher.mock.calls[0]
      expect(url).toBe("https://api.opensend.test/messages")
      expect(JSON.parse(init!.body as string)).toEqual(body)
      expect(new Headers(init!.headers).get("idempotency-key")).toBe(
        "retry-message"
      )
    } finally {
      await f.close()
    }
  }
)
it("list/get tools preserve filters, cursors and errors and have read annotations", async () => {
  const f = await connectClient("fixture-credential")
  try {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        object: "list",
        data: [],
        has_more: false,
        next_cursor: null,
      })
    )
    vi.stubGlobal("fetch", fetcher)
    const tools = (await f.client.listTools()).tools
    expect(
      tools.find((t) => t.name === "list_messages")?.annotations?.readOnlyHint
    ).toBe(true)
    expect(
      tools.find((t) => t.name === "get_message")?.annotations?.readOnlyHint
    ).toBe(true)
    const filters = {
      channel: "whatsapp",
      cursor: "cursor+/",
      direction: "outbound",
      contact_id: "contact",
      created_after: "2026-10-01T00:00:00Z",
    }
    expect(
      (await f.client.callTool({ name: "list_messages", arguments: filters }))
        .isError
    ).not.toBe(true)
    expect(
      Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)
    ).toEqual(filters)
    await f.client.callTool({
      name: "get_message",
      arguments: { id: "id/one" },
    })
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.opensend.test/messages/id%2Fone"
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    fetcher.mockResolvedValue(
      Response.json(
        {
          name: "validation_error",
          message: "An open conversation window is required",
        },
        { status: 422 }
      )
    )
    const error = await f.client.callTool({
      name: "send_message",
      arguments: { channel: "whatsapp", to: "recipient", text: "Hello" },
    })
    expect(error.isError).toBe(true)
    expect(JSON.stringify(error.content)).toContain("open conversation window")
  } finally {
    await f.close()
  }
})
