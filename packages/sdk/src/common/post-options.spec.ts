import { Opensend } from "../resend"

const client = new Opensend("fixture-credential", {
  baseUrl: "https://api.test",
})
const options = {
  idempotencyKey: "retry-resource",
  headers: { "X-Trace": "trace" },
}
const fetcher = vi.fn<typeof fetch>()
const cases = [
  {
    name: "automations.create",
    path: "/automations",
    call: () =>
      client.automations.create(
        { name: "Workflow", steps: [], connections: [] },
        options
      ),
  },
  {
    name: "automations.duplicate",
    path: "/automations/item/duplicate",
    call: () => client.automations.duplicate("item", options),
  },
  {
    name: "broadcasts.send",
    path: "/broadcasts/item/send",
    call: () => client.broadcasts.send("item", undefined, options),
  },
  {
    name: "broadcasts.cancel",
    path: "/broadcasts/item/cancel",
    call: () => client.broadcasts.cancel("item", options),
  },
  {
    name: "broadcasts.duplicate",
    path: "/broadcasts/item/duplicate",
    call: () => client.broadcasts.duplicate("item", options),
  },
  {
    name: "contactProperties.create",
    path: "/contact-properties",
    call: () =>
      client.contactProperties.create(
        { key: "region", type: "string" },
        options
      ),
  },
  {
    name: "contacts.segments.add",
    path: "/contacts/item/segments/segment",
    call: () =>
      client.contacts.segments.add(
        { contactId: "item", segmentId: "segment" },
        options
      ),
  },
  {
    name: "domains.claims.verify",
    path: "/domains/item/claim/verify",
    call: () => client.domains.claims.verify("item", options),
  },
  {
    name: "domains.verify",
    path: "/domains/item/verify",
    call: () => client.domains.verify("item", options),
  },
  {
    name: "emails.cancel",
    path: "/emails/item/cancel",
    call: () => client.emails.cancel("item", options),
  },
  {
    name: "emails.share",
    path: "/emails/item/share",
    call: () => client.emails.share("item", undefined, options),
  },
  {
    name: "events.send",
    path: "/events/send",
    call: () =>
      client.events.send(
        { event: "customer.created", contactId: "item" },
        options
      ),
  },
  {
    name: "events.create",
    path: "/events",
    call: () => client.events.create({ name: "customer.created" }, options),
  },
  {
    name: "suppressions.add",
    path: "/suppressions",
    call: () =>
      client.suppressions.add({ email: "person@example.test" }, options),
  },
  {
    name: "suppressions.batch.add",
    path: "/suppressions/batch/add",
    call: () =>
      client.suppressions.batch.add(
        { emails: ["person@example.test"] },
        options
      ),
  },
  {
    name: "suppressions.batch.remove",
    path: "/suppressions/batch/remove",
    call: () => client.suppressions.batch.remove({ ids: ["item"] }, options),
  },
  {
    name: "templates.create",
    path: "/templates",
    call: () =>
      client.templates.create(
        { name: "Greeting", html: "<p>Hello</p>" },
        options
      ),
  },
  {
    name: "templates.duplicate",
    path: "/templates/item/duplicate",
    call: () => client.templates.duplicate("item", options),
  },
  {
    name: "templates.publish",
    path: "/templates/item/publish",
    call: () => client.templates.publish("item", options),
  },
  {
    name: "topics.create",
    path: "/topics",
    call: () =>
      client.topics.create(
        { name: "Updates", defaultSubscription: "opt_in" },
        options
      ),
  },
  {
    name: "knowledgeBases.search",
    path: "/knowledge-bases/item/search",
    call: () =>
      client.knowledgeBases.search("item", { query: "Hours" }, options),
  },
  {
    name: "botTools.test",
    path: "/bot-tools/item/test",
    call: () => client.botTools.test("item", { query: "Hours" }, options),
  },
  {
    name: "webhooks.events.replay",
    path: "/webhooks/item/events/event/replay",
    call: () =>
      client.webhooks.events.replay(
        { webhookId: "item", eventId: "event" },
        options
      ),
  },
  {
    name: "webhooks.rotateSigningSecret",
    path: "/webhooks/item/signing-secret/rotate",
    call: () => client.webhooks.rotateSigningSecret("item", options),
  },
  ...(["whatsapp", "messenger", "instagram"] as const).flatMap((channel) => [
    {
      name: `${channel}.messages.markRead`,
      path: `/${channel}/messages/item/read`,
      call: () =>
        client[channel].messages.markRead("item", { typing: true }, options),
    },
    {
      name: `${channel}.conversations.typing`,
      path: `/${channel}/conversations/item/typing`,
      call: () => client[channel].conversations.typing("item", true, options),
    },
  ]),
]
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal("fetch", fetcher)
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
test.each(cases)(
  "$name forwards POST request options without changing the body or error",
  async ({ call, path }) => {
    const error = {
      name: "validation_error",
      statusCode: 422,
      message: "Request refused",
    }
    fetcher.mockResolvedValue(Response.json(error, { status: 422 }))
    expect(await call()).toMatchObject({ data: null, error })
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe("https://api.test" + path)
    expect(init?.method).toBe("POST")
    const headers = new Headers(init?.headers)
    expect(headers.get("idempotency-key")).toBe("retry-resource")
    expect(headers.get("x-trace")).toBe("trace")
    if (init?.body)
      expect(JSON.parse(String(init.body))).not.toHaveProperty("idempotencyKey")
  }
)
test("topics.list forwards cursor options and preserves pagination metadata", async () => {
  const page = { object: "list", data: [], has_more: true }
  fetcher.mockResolvedValue(Response.json(page))
  expect(
    (await client.topics.list({ limit: 2, after: "anchor/one" })).data
  ).toEqual(page)
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.test/topics?limit=2&after=anchor%2Fone"
  )
})
test.each(["events", "attempts"] as const)(
  "webhook %s preserve backward cursors and list envelopes",
  async (kind) => {
    const page = { object: "list", data: [], has_more: true }
    fetcher.mockResolvedValue(Response.json(page))
    const result =
      kind === "events"
        ? await client.webhooks.events.list({
            webhookId: "webhook",
            limit: 2,
            before: "anchor/one",
          })
        : await client.webhooks.events.attempts.list({
            webhookId: "webhook",
            eventId: "event",
            limit: 2,
            before: "anchor/one",
          })
    expect(result.data).toEqual(page)
    expect(fetcher.mock.calls[0][0]).toBe(
      `https://api.test/webhooks/webhook/events${kind === "attempts" ? "/event/attempts" : ""}?limit=2&before=anchor%2Fone`
    )
  }
)
