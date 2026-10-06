import { Opensend } from "../resend"
import { API_SCOPES, type ApiScope } from "../index"

const client = new Opensend("fixture-credential", {
  baseUrl: "https://api.test",
})
const fetcher = vi.fn<typeof fetch>()
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal("fetch", fetcher)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
test.each(["email", "whatsapp", "messenger", "instagram"] as const)(
  "unified create alias sends %s with idempotency",
  async (channel) => {
    fetcher.mockResolvedValue(Response.json({ id: "message" }))
    const result = await client.messages.create(
      { channel, to: "recipient", text: "Hello" },
      { idempotencyKey: "retry-message" }
    )
    expect(result).toMatchObject({ data: { id: "message" }, error: null })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("https://api.test/messages")
    expect(JSON.parse(init!.body as string)).toEqual({
      channel,
      to: "recipient",
      text: "Hello",
    })
    expect(new Headers(init!.headers).get("idempotency-key")).toBe(
      "retry-message"
    )
  }
)
test.each(["whatsapp", "messenger", "instagram"] as const)(
  "%s listMessages alias preserves ID pagination",
  async (channel) => {
    const page = { object: "list", data: [{ id: "message" }], has_more: true }
    fetcher.mockResolvedValue(Response.json(page))
    expect(
      (
        await client[channel].conversations.listMessages("id/one", {
          limit: 2,
          before: "anchor/one",
        })
      ).data
    ).toEqual(page)
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://api.test/${channel}/conversations/id%2Fone/messages?limit=2&before=anchor%2Fone`
    )
  }
)
test("stop accepts idempotency options and encodes the automation id", async () => {
  const data = { object: "automation", id: "automation", status: "disabled" }
  fetcher.mockResolvedValue(Response.json(data))
  expect(
    (await client.automations.stop("id/one", { idempotencyKey: "retry-stop" }))
      .data
  ).toEqual(data)
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe("https://api.test/automations/id%2Fone/stop")
  expect(new Headers(init!.headers).get("idempotency-key")).toBe("retry-stop")
})
for (const [name, statusCode] of [
  ["validation_error", 422],
  ["not_found", 404],
  ["restricted_api_key", 403],
] as const)
  test(`aliases and stop preserve ${name}`, async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const error = { name, statusCode, message: "Request refused" }
    fetcher.mockImplementation(async () =>
      Response.json(error, { status: statusCode })
    )
    for (const call of [
      () =>
        client.messages.create({
          channel: "whatsapp",
          to: "recipient",
          text: "Hello",
        }),
      () => client.automations.stop("automation"),
      ...(["whatsapp", "messenger", "instagram"] as const).map(
        (channel) => () =>
          client[channel].conversations.listMessages("conversation")
      ),
    ])
      expect(await call()).toMatchObject({ data: null, error })
  })
test("Custom API key consumers can use the shared typed scope catalog", async () => {
  const scopes: ApiScope[] = ["whatsapp:write", "contacts:read"]
  expect(scopes.every((scope) => API_SCOPES.includes(scope))).toBe(true)
  fetcher.mockResolvedValue(
    Response.json({ id: "credential", token: "credential-placeholder" })
  )
  await client.apiKeys.create({
    name: "Messaging",
    permission: "custom",
    scopes,
  })
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({
    name: "Messaging",
    permission: "custom",
    scopes,
  })
})
