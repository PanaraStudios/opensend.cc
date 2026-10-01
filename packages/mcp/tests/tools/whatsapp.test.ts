import { afterEach, describe, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe("WhatsApp tools through the real SDK", () => {
  it("registers four tools with read hints and sends templates/replies/idempotency", async () => {
    const f = await connectClient()
    try {
      const definitions = (await f.client.listTools()).tools.filter((t) =>
        [
          "send-whatsapp-message",
          "list-whatsapp-messages",
          "get-whatsapp-message",
          "list-whatsapp-phone-numbers",
        ].includes(t.name)
      )
      expect(definitions).toHaveLength(4)
      expect(
        definitions.find((t) => t.name === "get-whatsapp-message")?.annotations
          ?.readOnlyHint
      ).toBe(true)
      const fetcher = vi.fn(async () => Response.json({ id: "message" }))
      vi.stubGlobal("fetch", fetcher)
      const result = await f.client.callTool({
        name: "send-whatsapp-message",
        arguments: {
          to: "16505551234",
          from: "phone",
          template: {
            name: "hello",
            language: "en",
            variables: { "1": "Ada" },
          },
          replyTo: "reply",
          idempotencyKey: "key",
        },
      })
      expect(result.isError).not.toBe(true)
      const args = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(args[0]).toBe("https://api.opensend.test/whatsapp/messages")
      expect(JSON.parse(args[1].body as string)).toMatchObject({
        reply_to: "reply",
        template: { name: "hello" },
      })
      expect(new Headers(args[1].headers).get("idempotency-key")).toBe("key")
    } finally {
      await f.close()
    }
  })
  it("lists and gets using filters/cursors and returns typed API errors", async () => {
    const f = await connectClient()
    try {
      const requests: string[] = []
      vi.spyOn(console, "error").mockImplementation(() => {})
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          requests.push(url)
          return Response.json(
            { message: "Refused", name: "validation_error", statusCode: 422 },
            { status: 422 }
          )
        })
      )
      for (const [name, args, path] of [
        [
          "list-whatsapp-messages",
          {
            limit: 1,
            after: "cursor",
            status: "sent",
            direction: "outbound",
            phoneNumberId: "phone",
          },
          "/whatsapp/messages?limit=1&after=cursor&status=sent&direction=outbound&phone_number_id=phone",
        ],
        [
          "get-whatsapp-message",
          { id: "id/one" },
          "/whatsapp/messages/id%2Fone",
        ],
        [
          "list-whatsapp-phone-numbers",
          { before: "cursor" },
          "/whatsapp/phone-numbers?before=cursor",
        ],
      ] as const) {
        const result = await f.client.callTool({ name, arguments: args })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toContain("Refused")
        expect(requests.at(-1)).toBe(`https://api.opensend.test${path}`)
      }
      const count = requests.length
      const invalid = await f.client.callTool({
        name: "send-whatsapp-message",
        arguments: { to: "16505551234", text: "Hi", image: { id: "1" } },
      })
      expect(invalid.isError).toBe(true)
      const badPage = await f.client.callTool({
        name: "list-whatsapp-messages",
        arguments: { after: "a", before: "b" },
      })
      expect(badPage.isError).toBe(true)
      expect(requests).toHaveLength(count)
    } finally {
      await f.close()
    }
  })
})
