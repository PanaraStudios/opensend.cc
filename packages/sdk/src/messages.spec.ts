import { Opensend } from "./resend"
import type { Message, SendMessageOptions } from "./messages"

const fetcher = vi.fn<typeof fetch>()
const client = new Opensend("fixture-credential", {
  baseUrl: "https://api.test",
})
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal("fetch", fetcher)
})
afterEach(() => vi.unstubAllGlobals())
test.each(["email", "whatsapp", "messenger", "instagram"] as const)(
  "sends %s through the unified endpoint with idempotency",
  async (channel) => {
    fetcher.mockResolvedValue(Response.json({ id: "message" }))
    const body: SendMessageOptions =
      channel === "email"
        ? {
            channel,
            to: ["person@example.test"],
            subject: "Hello",
            text: "Hello",
          }
        : { channel, to: "recipient", text: "Hello", reply_to: "previous" }
    expect(
      (await client.messages.send(body, { idempotencyKey: "retry-message" }))
        .data
    ).toEqual({ id: "message" })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("https://api.test/messages")
    expect(JSON.parse(init!.body as string)).toEqual(body)
    expect(new Headers(init!.headers).get("idempotency-key")).toBe(
      "retry-message"
    )
  }
)
test("encodes opaque cursors, every filter and get ids", async () => {
  fetcher.mockResolvedValue(
    Response.json({
      object: "list",
      data: [],
      has_more: false,
      next_cursor: null,
    })
  )
  const options = {
    limit: 2,
    cursor: '{"cursor":"a+/b"}',
    channel: "whatsapp" as const,
    direction: "outbound" as const,
    status: "queued",
    contact_id: "contact",
    from: "+1555",
    to: "recipient",
    created_after: "2026-10-01T00:00:00Z",
    created_before: "2026-10-02T00:00:00Z",
  }
  await client.messages.list(options)
  expect(
    Object.fromEntries(new URL(String(fetcher.mock.calls[0][0])).searchParams)
  ).toEqual({ ...options, limit: "2" })
  await client.messages.get("id/one")
  expect(fetcher.mock.calls[1][0]).toBe("https://api.test/messages/id%2Fone")
})
test("preserves errors and discriminates email recipients by channel", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  fetcher.mockResolvedValue(
    Response.json(
      { name: "restricted_api_key", message: "Need whatsapp:write" },
      { status: 403 }
    )
  )
  expect(
    (
      await client.messages.send({
        channel: "whatsapp",
        to: "recipient",
        text: "Hi",
      })
    ).error?.name
  ).toBe("restricted_api_key")
  const narrow = (message: Message) =>
    message.channel === "email"
      ? message.to.join(",")
      : message.to.toUpperCase()
  expect(
    narrow({
      channel: "email",
      id: "message",
      object: "message",
      direction: "outbound",
      from: "sender",
      to: ["recipient"],
      status: "sent",
      preview: "Hello",
      created_at: "2026-10-01",
      contact_id: null,
      subject: "Hello",
      html: null,
      text: "Hello",
    })
  ).toBe("recipient")
  // @ts-expect-error Email-only fields cannot be sent to Meta channels.
  const invalid: SendMessageOptions = {
    channel: "whatsapp",
    to: "recipient",
    subject: "Email only",
  }
  void invalid
  vi.restoreAllMocks()
})
