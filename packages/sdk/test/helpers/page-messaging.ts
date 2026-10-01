import type { PageChannel } from "../../src/channels/interfaces"
import createFetchMock from "vitest-fetch-mock"
import { Opensend } from "../../src/resend"
import type { SendMessengerMessageOptions } from "../../src/messenger/interfaces"
import type { SendInstagramMessageOptions } from "../../src/instagram/interfaces"
const fetchMocker = createFetchMock(vi)
fetchMocker.enableMocks()
afterAll(() => {
  fetchMocker.disableMocks()
})
export function pageMessagingTests(channel: PageChannel) {
  describe(`${channel} resource`, () => {
    const client = new Opensend("os_test", {
      baseUrl: "https://api.opensend.test",
    })
    beforeEach(() => {
      fetchMock.resetMocks()
    })
    it("sends text, attachments and stored templates with wire fields and idempotency", async () => {
      for (const body of [
        { text: "Hello", quick_replies: [{ title: "Yes", payload: "yes" }] },
        { attachment: { type: "image", url: "https://example.com/image.png" } },
        { attachment: { type: "file", id: "asset" } },
        { template: { alias: "welcome", variables: { name: "Ada" } } },
        { template: { id: "template" } },
      ]) {
        fetchMock.mockResponseOnce(JSON.stringify({ id: "message" }))
        const payload = {
          from: "account",
          to: "scoped-contact",
          tag: "HUMAN_AGENT",
          replyTo: "reply",
          tags: [{ name: "crm", value: "ticket" }],
          ...body,
        }
        const result =
          channel === "messenger"
            ? await client.messenger.messages.send(
                payload as SendMessengerMessageOptions,
                { idempotencyKey: "key" }
              )
            : await client.instagram.messages.send(
                payload as SendInstagramMessageOptions,
                { idempotencyKey: "key" }
              )
        expect(result).toMatchObject({ data: { id: "message" }, error: null })
        const [url, init] = fetchMock.mock.calls.at(-1)!
        expect(url).toBe(`https://api.opensend.test/${channel}/messages`)
        expect(JSON.parse(init!.body as string)).toEqual({
          from: "account",
          to: "scoped-contact",
          tag: "HUMAN_AGENT",
          reply_to: "reply",
          tags: payload.tags,
          ...body,
        })
        expect(new Headers(init!.headers).get("idempotency-key")).toBe("key")
      }
    })
    it("reads all routes with cursors, filters and encoded identifiers", async () => {
      const resource = client[channel]
      const accounts =
        channel === "messenger"
          ? client.messenger.pages
          : client.instagram.accounts
      const segment = channel === "messenger" ? "pages" : "accounts"
      const requests: [() => Promise<unknown>, string][] = [
        [() => resource.messages.get("id/one"), "messages/id%2Fone"],
        [() => resource.messages.list(), "messages"],
        [
          () =>
            resource.messages.list({
              limit: 1,
              after: "a",
              status: "sent",
              direction: "outbound",
              accountId: "account",
            }),
          `messages?limit=1&after=a&status=sent&direction=outbound&${channel === "messenger" ? "page_id" : "account_id"}=account`,
        ],
        [() => accounts.list({ before: "cursor" }), `${segment}?before=cursor`],
        [() => accounts.get("id/one"), `${segment}/id%2Fone`],
        [
          () => resource.conversations.list({ limit: 2 }),
          "conversations?limit=2",
        ],
        [
          () => resource.conversations.messages("id/one", { after: "cursor" }),
          "conversations/id%2Fone/messages?after=cursor",
        ],
      ]
      for (const [call, path] of requests) {
        const data = { object: "list", has_more: false, data: [] }
        fetchMock.mockResponseOnce(JSON.stringify(data))
        expect(await call()).toMatchObject({ data, error: null })
        expect(fetchMock.mock.calls.at(-1)![0]).toBe(
          `https://api.opensend.test/${channel}/${path}`
        )
      }
    })
    it("preserves typed API errors including window rejection", async () => {
      const error = {
        statusCode: 422,
        name: "validation_error",
        message:
          "The 24-hour messaging window is closed. Pass a message tag such as HUMAN_AGENT.",
      }
      fetchMock.mockResponseOnce(JSON.stringify(error), { status: 422 })
      expect(
        await client[channel].messages.send({ to: "contact", text: "Hello" })
      ).toMatchObject({ data: null, error })
    })
  })
}
