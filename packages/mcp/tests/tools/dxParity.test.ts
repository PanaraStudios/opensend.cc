import { afterEach, describe, expect, it, vi } from "vitest"
import { connectClient, baseUrl } from "../helpers/client.js"

type Operation = {
  name: string
  method: string
  path: string
  args: Record<string, unknown>
  body?: Record<string, unknown>
}
const operations: Operation[] = [
  ...(["whatsapp", "messenger", "instagram"] as const).flatMap((channel) => [
    {
      name: `get-${channel}-${channel === "whatsapp" ? "phone-number" : channel === "messenger" ? "page" : "account"}`,
      method: "GET",
      path: `/${channel}/${channel === "whatsapp" ? "phone-numbers" : channel === "messenger" ? "pages" : "accounts"}/id%2Fone`,
      args: { id: "id/one" },
    },
    {
      name: `list-${channel}-conversations`,
      method: "GET",
      path: `/${channel}/conversations?limit=2&after=anchor%2Fone`,
      args: { limit: 2, after: "anchor/one" },
    },
    {
      name: `list-${channel}-conversation-messages`,
      method: "GET",
      path: `/${channel}/conversations/id%2Fone/messages?limit=2&before=anchor%2Fone`,
      args: { id: "id/one", limit: 2, before: "anchor/one" },
    },
  ]),
  {
    name: "stop-automation",
    method: "POST",
    path: "/automations/id%2Fone/stop",
    args: { id: "id/one", idempotencyKey: "retry-operation" },
  },
  {
    name: "create-voice-provider",
    method: "POST",
    path: "/voice-providers",
    args: {
      provider: "gemini",
      label: "Local",
      key: "credential-placeholder",
      idempotencyKey: "retry-operation",
    },
    body: { provider: "gemini", label: "Local", key: "credential-placeholder" },
  },
  {
    name: "list-voice-providers",
    method: "GET",
    path: "/voice-providers?limit=2&after=anchor%2Fone",
    args: { limit: 2, after: "anchor/one" },
  },
  {
    name: "remove-voice-provider",
    method: "DELETE",
    path: "/voice-providers/id%2Fone",
    args: { id: "id/one" },
  },
  {
    name: "patch-whatsapp-calling",
    method: "PATCH",
    path: "/whatsapp/phone-numbers/id%2Fone/calling",
    args: { id: "id/one", handling_mode: "gateway" },
    body: { handling_mode: "gateway" },
  },
  {
    name: "upload-whatsapp-media",
    method: "POST",
    path: "/whatsapp/media",
    args: {
      content: "SGVsbG8=",
      contentType: "text/plain",
      filename: "hello.txt",
      from: "sender",
      idempotencyKey: "retry-operation",
    },
  },
  {
    name: "send-message",
    method: "POST",
    path: "/messages",
    args: {
      channel: "whatsapp",
      to: "recipient",
      text: "Hello",
      idempotencyKey: "retry-operation",
    },
    body: { channel: "whatsapp", to: "recipient", text: "Hello" },
  },
  {
    name: "get-message",
    method: "GET",
    path: "/messages/id%2Fone",
    args: { id: "id/one" },
  },
  {
    name: "list-messages",
    method: "GET",
    path: "/messages?limit=2&cursor=opaque%2Fcursor",
    args: { limit: 2, cursor: "opaque/cursor" },
  },
  {
    name: "mark-message-read",
    method: "POST",
    path: "/messenger/messages/id%2Fone/read",
    args: { channel: "messenger", id: "id/one", typing: true },
    body: { typing: true },
  },
  {
    name: "set-typing",
    method: "POST",
    path: "/instagram/conversations/id%2Fone/typing",
    args: { channel: "instagram", id: "id/one", on: false },
    body: { on: false },
  },
]
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe("v2 additions through the real SDK", () => {
  it.each(operations)(
    "$name preserves requests and structured responses",
    async (op) => {
      const f = await connectClient()
      try {
        const data = op.name.startsWith("list-")
          ? {
              object: "list",
              data: [{ id: "item" }],
              has_more: true,
              ...(op.name === "list-messages" ? { next_cursor: "next" } : {}),
            }
          : op.name === "stop-automation"
            ? { object: "automation", id: "automation", status: "disabled" }
            : { id: "item" }
        const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(data))
        vi.stubGlobal("fetch", fetcher)
        const result = await f.client.callTool({
          name: op.name,
          arguments: op.args,
        })
        expect(result.isError, JSON.stringify(result)).not.toBe(true)
        expect(result.structuredContent).toEqual(data)
        const [url, init] = fetcher.mock.calls[0]
        expect(url).toBe(baseUrl + op.path)
        expect(init?.method).toBe(op.method)
        if (op.body) expect(JSON.parse(init!.body as string)).toEqual(op.body)
        if (op.args.idempotencyKey)
          expect(new Headers(init?.headers).get("idempotency-key")).toBe(
            op.args.idempotencyKey
          )
        if (op.name === "upload-whatsapp-media") {
          expect(new Headers(init?.headers).has("content-type")).toBe(false)
          const form = init!.body as FormData
          expect(form.get("from")).toBe("sender")
          expect(form.get("type")).toBe("text/plain")
          const file = form.get("file") as File
          expect(file.name).toBe("hello.txt")
          expect(await file.text()).toBe("Hello")
        }
      } finally {
        await f.close()
      }
    }
  )
  for (const [name, statusCode] of [
    ["validation_error", 422],
    ["not_found", 404],
    ["restricted_api_key", 403],
  ] as const)
    it.each(operations)(`$name preserves ${name}`, async (op) => {
      const f = await connectClient()
      try {
        vi.spyOn(console, "error").mockImplementation(() => {})
        vi.stubGlobal(
          "fetch",
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(
              Response.json(
                { name, statusCode, message: "Request refused" },
                { status: statusCode }
              )
            )
        )
        const result = await f.client.callTool({
          name: op.name,
          arguments: op.args,
        })
        expect(result.isError).toBe(true)
        const text = JSON.stringify(result.content)
        expect(text).toContain(name)
        expect(text).toContain(String(statusCode))
        expect(text).toContain("Request refused")
      } finally {
        await f.close()
      }
    })
  it.each(["whatsapp", "messenger", "instagram", "voice-providers"])(
    "%s rejects conflicting page cursors before fetching",
    async (channel) => {
      const f = await connectClient()
      try {
        const fetcher = vi.fn()
        vi.stubGlobal("fetch", fetcher)
        const result = await f.client.callTool({
          name:
            channel === "voice-providers"
              ? "list-voice-providers"
              : `list-${channel}-conversations`,
          arguments: { after: "forward", before: "backward" },
        })
        expect(result.isError).toBe(true)
        expect(fetcher).not.toHaveBeenCalled()
      } finally {
        await f.close()
      }
    }
  )
})
it.each([
  { name: "list-topics", path: "/topics", args: {} },
  { name: "list-broadcasts", path: "/broadcasts", args: {} },
  { name: "list-webhooks", path: "/webhooks", args: {} },
  {
    name: "list-webhook-events",
    path: "/webhooks/webhook/events",
    args: { webhookId: "webhook" },
  },
  {
    name: "list-webhook-event-attempts",
    path: "/webhooks/webhook/events/event/attempts",
    args: { webhookId: "webhook", eventId: "event" },
  },
])("$name forwards added pagination options", async ({ name, path, args }) => {
  const f = await connectClient()
  try {
    const page = { object: "list", data: [], has_more: true }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(page))
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name,
      arguments: { ...args, limit: 2, before: "anchor/one" },
    })
    expect(result.isError, JSON.stringify(result)).not.toBe(true)
    const url = new URL(String(fetcher.mock.calls[0][0]))
    expect(url.pathname).toBe(path)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      limit: "2",
      before: "anchor/one",
    })
    const invalid = await f.client.callTool({
      name,
      arguments: { ...args, after: "next", before: "previous" },
    })
    expect(invalid.isError).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.structuredContent).toEqual(page)
  } finally {
    await f.close()
  }
})
