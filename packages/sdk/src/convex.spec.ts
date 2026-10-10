import { afterEach, expect, it, vi } from "vitest"
import { Opensend } from "./convex"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("uses the shared SDK transport and serialization without Node media or React rendering", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ id: "email_1" }))
  vi.stubGlobal("fetch", fetch)
  const client = new Opensend("os_test", {
    baseUrl: "https://self-hosted.example.com/",
  })
  expect(
    await client.emails.send(
      {
        to: "a@example.com",
        template: { id: "welcome", variables: { count: 3 } },
        scheduledAt: "2030-01-01T00:00:00Z",
      },
      { idempotencyKey: "same-key" }
    )
  ).toMatchObject({ data: { id: "email_1" }, error: null })
  const [url, request] = fetch.mock.calls[0]
  expect(url).toBe("https://self-hosted.example.com/emails")
  expect(new Headers(request.headers).get("Idempotency-Key")).toBe("same-key")
  expect(JSON.parse(request.body)).toMatchObject({
    template: { id: "welcome", variables: { count: 3 } },
    scheduled_at: "2030-01-01T00:00:00Z",
  })
})

it("fills missing HTTP error status for gateway errors so Convex retries 429/503", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { name: "gateway_error", message: "Unavailable" },
          { status: 503 }
        )
      )
  )
  const client = new Opensend("os_test", {
    baseUrl: "https://self-hosted.example.com",
  })
  expect(
    await client.emails.send({
      from: "sender@example.com",
      to: "a@example.com",
      subject: "Hello",
      text: "Hello",
    })
  ).toMatchObject({
    error: { name: "gateway_error", statusCode: 503, message: "Unavailable" },
  })
})
