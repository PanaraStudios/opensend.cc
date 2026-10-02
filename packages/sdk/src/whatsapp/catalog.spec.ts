import { readFileSync } from "node:fs"
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import { Opensend } from "../resend"
import type {
  SendWhatsAppMessageOptions,
  WhatsAppMessage,
  WhatsAppMessageEvent,
} from "../index"
import { validateWhatsAppBody } from "./validation"
import { normalizeWhatsAppMessage } from "./normalize"
const fixtures = JSON.parse(
  readFileSync(
    new URL("../../../../lib/meta/whatsapp-fixtures.json", import.meta.url),
    "utf8"
  )
) as {
  send: Record<string, Record<string, unknown>>
  inbound: Record<string, Record<string, unknown>>
}
afterEach(() => vi.unstubAllGlobals())
describe("WhatsApp catalog SDK contract", () => {
  for (const [name, body] of Object.entries(fixtures.send))
    it(`sends ${name} without losing catalog fields`, async () => {
      const fetcher = vi.fn(async () => Response.json({ id: "message" }))
      vi.stubGlobal("fetch", fetcher)
      const client = new Opensend("os_test", {
        baseUrl: "https://api.opensend.test",
      })
      expect(validateWhatsAppBody(body)).toBeDefined()
      await client.whatsapp.messages.send(
        {
          recipient: "BSUID-123",
          biz_opaque_callback_data: "crm-1",
          ...body,
        } as SendWhatsAppMessageOptions,
        { idempotencyKey: `catalog-${name}` }
      )
      const call = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(call[0]).toBe("https://api.opensend.test/whatsapp/messages")
      expect(JSON.parse(call[1].body as string)).toEqual({
        recipient: "BSUID-123",
        biz_opaque_callback_data: "crm-1",
        ...body,
      })
      expect(new Headers(call[1].headers).get("idempotency-key")).toBe(
        `catalog-${name}`
      )
    })
  for (const [name, body] of Object.entries(fixtures.inbound))
    it(`receives ${name} through get/list/webhook types with raw preserved`, async () => {
      const normalized = normalizeWhatsAppMessage({
        id: "wamid.example",
        from_user_id: "BSUID-123",
        ...body,
      })
      const message = { id: "message", ...normalized }
      const fetcher = vi.fn(async (url: string) =>
        Response.json(
          url.endsWith("/messages")
            ? { object: "list", has_more: false, data: [message] }
            : { ...message, media: [], events: [], last_event: "received" }
        )
      )
      vi.stubGlobal("fetch", fetcher)
      const client = new Opensend("os_test", {
        baseUrl: "https://api.opensend.test",
      })
      const detail = await client.whatsapp.messages.get("message")
      const page = await client.whatsapp.messages.list()
      expect(detail.data).toMatchObject(normalized)
      expect(page.data?.data[0]).toMatchObject(normalized)
      expect(normalized.raw).toMatchObject(body)
      expect(normalized.identity).toEqual({ user_id: "BSUID-123" })
    })
  it("narrows content by message type without casts, including a played customer event", () => {
    const narrow = (message: WhatsAppMessage) => {
      if (message.type === "audio")
        expectTypeOf(message.content.voice).toEqualTypeOf<boolean | undefined>()
      if (message.type === "system")
        expectTypeOf(message.content.user_id).toEqualTypeOf<
          string | undefined
        >()
      if (
        message.type === "interactive" &&
        message.content.type === "nfm_reply"
      )
        expectTypeOf(
          message.content.nfm_reply.response_json
        ).toEqualTypeOf<string>()
      if (message.type === "order")
        expectTypeOf(message.content.catalog_id).toEqualTypeOf<string>()
    }
    expectTypeOf(narrow).toBeFunction()
    const event: WhatsAppMessageEvent = {
      type: "whatsapp.message.played",
      created_at: "2026-10-01T00:00:00Z",
      data: {
        id: "id",
        channel: "whatsapp",
        account_id: "account",
        conversation_id: "thread",
        from: "phone",
        to: "BSUID",
        status: "played",
        direction: "outbound",
        external_id: "wamid",
        read_receipt_sent_at: null,
        created_at: "2026-10-01T00:00:00Z",
        tags: [],
        type: "audio",
        content: { id: "media", voice: true },
        identity: { user_id: "BSUID" },
        raw: { type: "audio", audio: { id: "media", voice: true } },
      },
    }
    expect(event.data.status).toBe("played")
  })
})
