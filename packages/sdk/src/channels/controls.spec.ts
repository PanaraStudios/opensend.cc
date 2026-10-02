import createFetchMock from "vitest-fetch-mock"
import { Opensend } from "../resend"
const mocker = createFetchMock(vi)
mocker.enableMocks()
const client = new Opensend("os_test", { baseUrl: "https://api.opensend.test" })
beforeEach(() => {
  fetchMock.resetMocks()
})
afterAll(() => {
  mocker.disableMocks()
})
describe("channel read receipts and typing", () => {
  it.each(["whatsapp", "messenger", "instagram"] as const)(
    "%s encodes ids and preserves read/typing bodies",
    async (channel) => {
      for (const typing of [undefined, true, false]) {
        fetchMock.mockResponseOnce(JSON.stringify({ id: "message" }), {
          status: 202,
        })
        const result = await client[channel].messages.markRead("id/one", {
          typing,
        })
        expect(result).toMatchObject({ data: { id: "message" }, error: null })
        const [url, init] = fetchMock.mock.calls.at(-1)!
        expect(url).toBe(
          `https://api.opensend.test/${channel}/messages/id%2Fone/read`
        )
        expect(init!.method).toBe("POST")
        expect(JSON.parse(init!.body as string)).toEqual(
          typing === undefined ? {} : { typing }
        )
      }
      for (const on of [true, false]) {
        fetchMock.mockResponseOnce(JSON.stringify({ id: "conversation" }))
        await client[channel].conversations.typing("thread/one", on)
        const [url, init] = fetchMock.mock.calls.at(-1)!
        expect(url).toBe(
          `https://api.opensend.test/${channel}/conversations/thread%2Fone/typing`
        )
        expect(JSON.parse(init!.body as string)).toEqual({ on })
      }
    }
  )
  it("returns typed API errors for unsupported controls", async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        statusCode: 422,
        name: "validation_error",
        message: "WhatsApp does not support typing_off",
      }),
      { status: 422 }
    )
    expect(
      await client.whatsapp.conversations.typing("thread", false)
    ).toMatchObject({
      data: null,
      error: {
        name: "validation_error",
        message: "WhatsApp does not support typing_off",
      },
    })
  })
})
