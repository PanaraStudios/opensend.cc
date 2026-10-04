import { Opensend } from "../resend"

const fetcher = vi.fn<typeof fetch>()
const client = new Opensend("fixture-credential", {
  baseUrl: "https://api.test",
})
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal("fetch", fetcher)
})
afterEach(() => vi.unstubAllGlobals())
const channels = ["email", "whatsapp", "messenger", "instagram"] as const

test.each(channels)(
  "%s send/create preserve data/error and idempotency",
  async (channel) => {
    for (const method of ["send", "create"] as const) {
      fetcher.mockResolvedValueOnce(Response.json({ id: "message" }))
      const options = { idempotencyKey: "test-send" }
      const result =
        channel === "email"
          ? await client.emails[method](
              {
                from: "team@example.test",
                to: "ada@example.test",
                subject: "Hello",
                text: "Hello",
              },
              options
            )
          : channel === "whatsapp"
            ? await client.whatsapp.messages[method](
                { to: "+15551234567", text: { body: "Hello" } },
                options
              )
            : await client[channel].messages[method](
                { to: "recipient", text: "Hello" },
                options
              )
      expect(result).toMatchObject({ data: { id: "message" }, error: null })
      const [url, request] = fetcher.mock.calls.at(-1)!
      expect(url).toBe(
        `https://api.test/${channel === "email" ? "emails" : `${channel}/messages`}`
      )
      expect(new Headers(request!.headers).get("idempotency-key")).toBe(
        "test-send"
      )
    }
  }
)
test.each(channels)(
  "%s preserves list pagination and encodes cursor anchors",
  async (channel) => {
    const resource =
      channel === "email" ? client.emails : client[channel].messages
    const page = { object: "list", data: [{ id: "message" }], has_more: true }
    fetcher.mockResolvedValue(Response.json(page))
    const result = await resource.list({ limit: 2, after: "id+/one" })
    expect(result).toMatchObject({ data: page, error: null })
    const query = new URL(String(fetcher.mock.calls[0][0])).searchParams
    expect(Object.fromEntries(query)).toEqual({ limit: "2", after: "id+/one" })
  }
)
for (const name of [
  "validation_error",
  "not_found",
  "restricted_api_key",
] as const) {
  test.each(channels)(
    `%s retains ${name} without a channel-specific wrapper`,
    async (channel) => {
      fetcher.mockResolvedValue(
        Response.json(
          {
            statusCode:
              name === "not_found"
                ? 404
                : name === "restricted_api_key"
                  ? 403
                  : 422,
            name,
            message: "Request refused",
          },
          {
            status:
              name === "not_found"
                ? 404
                : name === "restricted_api_key"
                  ? 403
                  : 422,
          }
        )
      )
      const resource =
        channel === "email" ? client.emails : client[channel].messages
      expect(await resource.get("missing-message")).toMatchObject({
        data: null,
        error: { name, message: "Request refused" },
      })
    }
  )
}
