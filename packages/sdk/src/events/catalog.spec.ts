import { afterEach, expect, it, vi } from "vitest"
import { Resend } from "../resend"
import { SYSTEM_EVENT_CATALOG, SYSTEM_EVENT_NAMES } from "./catalog"

afterEach(() => vi.unstubAllGlobals())
it("fetches the typed catalog and preserves nested schemas and note triggers", async () => {
  const body = { object: "event_catalog", data: SYSTEM_EVENT_CATALOG }
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal("fetch", fetcher)
  const client = new Resend("fixture-token")
  const result = await client.events.catalog()
  expect(result.error).toBeNull()
  expect(result.data).toEqual(body)
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.opensend.test/events/catalog"
  )
  expect(SYSTEM_EVENT_NAMES).toContain("contact.note_created")
  expect(
    result.data?.data.find((event) => event.name === "contact.note_created")
  ).toMatchObject({
    trigger: "contact.note_created",
    schema: {
      fields: {
        body: { type: "string" },
        author: { fields: { kind: { type: "enum" } } },
      },
    },
  })
})
it("returns catalog errors without discarding the SDK response shape", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async () =>
      Response.json(
        { name: "restricted_api_key", message: "Missing events:read" },
        { status: 403 }
      )
    )
  )
  const result = await new Resend("fixture-token").events.catalog()
  expect(result.data).toBeNull()
  expect(result.error).toMatchObject({ message: "Missing events:read" })
})
