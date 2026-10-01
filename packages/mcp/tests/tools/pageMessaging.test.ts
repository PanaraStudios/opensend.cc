import { afterEach, describe, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe.each(["messenger", "instagram"] as const)(
  "%s tools through the real SDK",
  (channel) => {
    it("registers four tools and sends each body with reply fields and idempotency", async () => {
      const f = await connectClient()
      try {
        const tools = (await f.client.listTools()).tools.filter((t) =>
          t.name.includes(channel)
        )
        expect(tools).toHaveLength(4)
        expect(
          tools.find((t) => t.name === `get-${channel}-message`)?.annotations
            ?.readOnlyHint
        ).toBe(true)
        const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
          Response.json({ id: "message" })
        )
        vi.stubGlobal("fetch", fetcher)
        for (const body of [
          { text: "Hello", quick_replies: [{ title: "Yes", payload: "yes" }] },
          {
            attachment: { type: "image", url: "https://example.com/image.png" },
          },
          { template: { alias: "hello", variables: { name: "Ada" } } },
        ]) {
          const result = await f.client.callTool({
            name: `send-${channel}-message`,
            arguments: {
              from: "account",
              to: "scoped-contact",
              tag: "HUMAN_AGENT",
              replyTo: "reply",
              idempotencyKey: "key",
              ...body,
            },
          })
          expect(result.isError).not.toBe(true)
          const [url, init] = fetcher.mock.calls.at(-1)!
          expect(url).toBe(`https://api.opensend.test/${channel}/messages`)
          expect(JSON.parse(init!.body as string)).toEqual({
            from: "account",
            to: "scoped-contact",
            tag: "HUMAN_AGENT",
            reply_to: "reply",
            ...body,
          })
          expect(new Headers(init!.headers).get("idempotency-key")).toBe("key")
        }
      } finally {
        await f.close()
      }
    })
    it("dispatches reads with filters/cursors and reports API errors", async () => {
      const f = await connectClient()
      try {
        vi.spyOn(console, "error").mockImplementation(() => {})
        const fetcher = vi.fn(async (_url: string) =>
          Response.json(
            { name: "validation_error", message: "Refused", statusCode: 422 },
            { status: 422 }
          )
        )
        vi.stubGlobal("fetch", fetcher)
        for (const [name, args, path] of [
          [
            `list-${channel}-messages`,
            {
              limit: 1,
              after: "cursor",
              status: "sent",
              direction: "outbound",
              accountId: "account",
            },
            `messages?limit=1&after=cursor&status=sent&direction=outbound&${channel === "messenger" ? "page_id" : "account_id"}=account`,
          ],
          [`get-${channel}-message`, { id: "id/one" }, "messages/id%2Fone"],
          [
            `list-${channel}-${channel === "messenger" ? "pages" : "accounts"}`,
            { before: "cursor" },
            `${channel === "messenger" ? "pages" : "accounts"}?before=cursor`,
          ],
        ] as const) {
          const result = await f.client.callTool({ name, arguments: args })
          expect(result.isError).toBe(true)
          expect(JSON.stringify(result.content)).toContain("Refused")
          expect(fetcher.mock.calls.at(-1)![0]).toBe(
            `https://api.opensend.test/${channel}/${path}`
          )
        }
      } finally {
        await f.close()
      }
    })
    it("rejects ambiguous bodies, attachments, templates, cursors and channel restrictions before fetch", async () => {
      const f = await connectClient()
      try {
        const fetcher = vi.fn()
        vi.stubGlobal("fetch", fetcher)
        const invalid = [
          {},
          { text: "Hello", template: { id: "template" } },
          { attachment: { type: "file" } },
          {
            attachment: {
              type: "file",
              id: "asset",
              url: "https://example.com/file",
            },
          },
          { template: {} },
          { template: { id: "one", alias: "two" } },
          {
            text: "Hello",
            quick_replies: Array.from({ length: 14 }, () => ({
              title: "Yes",
              payload: "yes",
            })),
          },
          { text: "Hello", tag: "ACCOUNT_UPDATE" },
          ...(channel === "instagram"
            ? [
                {
                  attachment: { type: "image", id: "asset" },
                  quick_replies: [],
                },
              ]
            : []),
        ]
        for (const body of invalid) {
          const result = await f.client.callTool({
            name: `send-${channel}-message`,
            arguments: { to: "contact", ...body },
          })
          expect(result.isError).toBe(true)
        }
        const page = await f.client.callTool({
          name: `list-${channel}-messages`,
          arguments: { after: "a", before: "b" },
        })
        expect(page.isError).toBe(true)
        expect(fetcher).not.toHaveBeenCalled()
      } finally {
        await f.close()
      }
    })
  }
)
