import { afterEach, expect, it, vi } from "vitest"
import { Opensend } from "../../resend"
const client = new Opensend("os_calling", {
  baseUrl: "https://api.example.test",
})
afterEach(() => vi.unstubAllGlobals())
it("exposes every calling operation, escapes IDs and preserves bodies and idempotency keys", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ id: "call", success: true })
    )
  vi.stubGlobal("fetch", fetch)
  await client.whatsapp.calls.connect(
    {
      recipient: "US.42",
      route: "gateway",
      recording: {
        status: "ENABLED",
        purpose: "Support",
        announcement_language: "en",
      },
    },
    { idempotencyKey: "connect-once" }
  )
  expect(fetch.mock.calls[0][0]).toBe("https://api.example.test/whatsapp/calls")
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
    recipient: "US.42",
    route: "gateway",
  })
  expect(
    new Headers(fetch.mock.calls[0][1].headers).get("Idempotency-Key")
  ).toBe("connect-once")
  const calls = client.whatsapp.calls
  await calls.get("call/42")
  await calls.preAccept("call/42", {
    session: { sdp_type: "answer", sdp: "complete SDP" },
  })
  await calls.accept("call/42", { transcription: { status: "DISABLED" } })
  await calls.reject("call/42")
  await calls.terminate("call/42")
  expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual(
    ["", "/pre_accept", "/accept", "/reject", "/terminate"].map(
      (s) => `https://api.example.test/whatsapp/calls/call%2F42${s}`
    )
  )
  await calls.list({ limit: 7, after: "call a", phoneNumberId: "pnid" })
  const url = new URL(fetch.mock.calls.at(-1)![0])
  expect(Object.fromEntries(url.searchParams)).toEqual({
    limit: "7",
    after: "call a",
    phone_number_id: "pnid",
  })
  await client.whatsapp.phoneNumbers.getCalling("number/1")
  await client.whatsapp.phoneNumbers.updateCalling("number/1", {
    calling: { status: "ENABLED" },
    handling_mode: "api",
    announcement_file_id: "file",
  })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/whatsapp/phone-numbers/number%2F1/calling"
  )
  await client.whatsapp.callPermissions.get({
    from: "pnid",
    recipient: "US.42",
  })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/whatsapp/call-permissions?from=pnid&recipient=US.42"
  )
  await client.whatsapp.callPermissions.request({
    recipient: "US.42",
    text: "May we call?",
  })
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({
    recipient: "US.42",
    text: "May we call?",
  })
})

it("places managed bot calls and gets/requests contact permissions without dropping prompt context", async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({
      status: "permission_requested",
      permission_request_id: "message",
    })
  )
  vi.stubGlobal("fetch", fetcher)
  const input = {
    from: "number",
    contact_id: "lead",
    route: "bot:coach" as const,
    context: "Seminar follow-up",
    variables: { seminar: "Saturday" },
    request_permission: true,
  }
  await client.whatsapp.calls.place(input, { idempotencyKey: "coach-followup" })
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual(input)
  expect(
    new Headers(fetcher.mock.calls[0][1].headers).get("idempotency-key")
  ).toBe("coach-followup")
  await client.whatsapp.callPermissions.getForContact("lead/1", {
    from: "number",
  })
  await client.whatsapp.callPermissions.requestForContact("lead/1", {
    from: "number",
    text: "May the coach call?",
  })
  expect(fetcher.mock.calls[1][0]).toBe(
    "https://api.example.test/contacts/lead%2F1/call-permission?from=number"
  )
  expect(fetcher.mock.calls[2][0]).toBe(
    "https://api.example.test/contacts/lead%2F1/call-permission"
  )
})
