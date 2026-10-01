import { afterEach, describe, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe("Meta conversation controls through the SDK", () => {
  it.each(["whatsapp", "messenger", "instagram"])(
    "%s read/typing tools preserve their payload and encode ids",
    async (channel) => {
      const f = await connectClient()
      try {
        const tools = (await f.client.listTools()).tools
        expect(
          tools.find((t) => t.name === "mark_message_read")?.annotations
            ?.readOnlyHint
        ).toBe(false)
        const fetcher = vi.fn(async () =>
          Response.json({ id: "message" }, { status: 202 })
        )
        vi.stubGlobal("fetch", fetcher)
        for (const [name, args, path, body] of [
          [
            "mark_message_read",
            { typing: true },
            "messages/id%2Fone/read",
            { typing: true },
          ],
          [
            "set_typing",
            { on: false },
            "conversations/id%2Fone/typing",
            { on: false },
          ],
        ] as const) {
          const result = await f.client.callTool({
            name,
            arguments: { channel, id: "id/one", ...args },
          })
          expect(result.isError).not.toBe(true)
          const [url, init] = fetcher.mock.calls.at(-1)! as unknown as [
            string,
            RequestInit,
          ]
          expect(url).toBe(`https://api.opensend.test/${channel}/${path}`)
          expect(JSON.parse(init.body as string)).toEqual(body)
        }
      } finally {
        await f.close()
      }
    }
  )
  it("rejects invalid booleans before a request and propagates provider failures", async () => {
    const f = await connectClient()
    try {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const fetcher = vi.fn(async () =>
        Response.json(
          { name: "meta_api_error", message: "Meta refused receipt" },
          { status: 502 }
        )
      )
      vi.stubGlobal("fetch", fetcher)
      expect(
        (
          await f.client.callTool({
            name: "set_typing",
            arguments: { channel: "whatsapp", id: "thread", on: "yes" },
          })
        ).isError
      ).toBe(true)
      expect(fetcher).not.toHaveBeenCalled()
      const result = await f.client.callTool({
        name: "mark_message_read",
        arguments: { channel: "whatsapp", id: "message" },
      })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain("Meta refused receipt")
    } finally {
      await f.close()
    }
  })
})
