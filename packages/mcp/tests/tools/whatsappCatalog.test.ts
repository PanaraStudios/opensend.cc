import { readFileSync } from "node:fs"
import { afterEach, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../../lib/meta/whatsapp-fixtures.json", import.meta.url),
    "utf8"
  )
) as {
  send: Record<string, Record<string, unknown>>
  inbound: Record<string, Record<string, unknown>>
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
for (const [name, body] of Object.entries(fixtures.send))
  it(`MCP schema and real SDK send ${name}`, async () => {
    const f = await connectClient()
    try {
      const fetcher = vi.fn(async () => Response.json({ id: "message" }))
      vi.stubGlobal("fetch", fetcher)
      const result = await f.client.callTool({
        name: "send-whatsapp-message",
        arguments: {
          recipient: "BSUID-123",
          ...body,
          idempotencyKey: "catalog",
        },
      })
      expect(result.isError, JSON.stringify(result)).not.toBe(true)
      const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(call[0]).toBe("https://api.opensend.test/whatsapp/messages")
      expect(JSON.parse(call[1].body as string)).toEqual({
        recipient: "BSUID-123",
        ...body,
      })
      const malformed = await f.client.callTool({
        name: "send-whatsapp-message",
        arguments: {
          recipient: "BSUID-123",
          ...body,
          [Object.keys(body)[0]]: null,
        },
      })
      expect(malformed.isError).toBe(true)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      await f.close()
    }
  })
for (const [name, body] of Object.entries(fixtures.inbound))
  it(`MCP get preserves normalized ${name}`, async () => {
    const f = await connectClient()
    try {
      const response = {
        id: "message",
        type: body.type,
        content: body[String(body.type)],
        raw: body,
        identity: { user_id: "BSUID-123" },
        status: "received",
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(response))
      )
      const result = await f.client.callTool({
        name: "get-whatsapp-message",
        arguments: { id: "message" },
      })
      expect(result.isError).not.toBe(true)
      expect(
        JSON.parse((result.content as { text: string }[])[0].text)
      ).toEqual(response)
      expect(result.structuredContent).toEqual(response)
    } finally {
      await f.close()
    }
  })
it("MCP advertises interactive discriminators and played; total rows fail before fetch", async () => {
  const f = await connectClient()
  try {
    const definitions = (await f.client.listTools()).tools
    expect(
      JSON.stringify(
        definitions.find((t) => t.name === "get-whatsapp-message")!.outputSchema
      )
    ).toContain("nfm_reply")
    expect(
      JSON.stringify(
        definitions.find((t) => t.name === "list-whatsapp-messages")!
          .outputSchema
      )
    ).toContain("identity")
    const send = definitions.find((t) => t.name === "send-whatsapp-message")!
    for (const type of [
      "contacts",
      "cta_url",
      "carousel",
      "flow",
      "address_message",
      "product_list",
      "order_details",
      "order_status",
      "call_permission_request",
    ])
      expect(JSON.stringify(send.inputSchema)).toContain(type)
    expect(
      JSON.stringify(
        definitions.find((t) => t.name === "list-whatsapp-messages")!
          .inputSchema
      )
    ).toContain("played")
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name: "send-whatsapp-message",
      arguments: {
        to: "16505551234",
        interactive: {
          type: "list",
          body: { text: "Choose" },
          action: {
            button: "Options",
            sections: [0, 1].map((i) => ({
              title: "Section",
              rows: Array.from({ length: 6 }, (_, j) => ({
                id: `${i}-${j}`,
                title: "Row",
              })),
            })),
          },
        },
      },
    })
    expect(result.isError).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    await f.close()
  }
})
