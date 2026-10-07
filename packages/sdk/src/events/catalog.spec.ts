import { afterEach, expect, it, vi } from "vitest"
import { Resend } from "../resend"
import {
  SYSTEM_EVENT_CATALOG,
  SYSTEM_EVENT_DESCRIPTIONS,
  SYSTEM_EVENT_NAMES,
} from "./catalog"

afterEach(() => vi.unstubAllGlobals())
it.each(SYSTEM_EVENT_NAMES)(
  "provides a readable description for %s",
  (name) => {
    expect(
      Object.prototype.hasOwnProperty.call(SYSTEM_EVENT_DESCRIPTIONS, name)
    ).toBe(true)
    const description = SYSTEM_EVENT_DESCRIPTIONS[name]
    expect(description).toMatch(/^[A-Z].+\.$/)
    expect(description).not.toMatch(
      /Emitted when|_|\b(?:whatsapp|messenger|instagram)\b/
    )
    expect(description).not.toContain(name)
    expect(
      SYSTEM_EVENT_CATALOG.find((event) => event.name === name)?.description
    ).toBe(description)
  }
)

it("fetches the typed catalog and preserves nested schemas and note triggers", async () => {
  const body = {
    object: "event_catalog",
    has_more: false,
    next_cursor: null,
    data: SYSTEM_EVENT_CATALOG,
  }
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal("fetch", fetcher)
  const client = new Resend("fixture-token")
  const result = await client.events.catalog()
  expect(result.error).toBeNull()
  expect(result.data).toEqual(body)
  expect(result.data?.object).toBe("event_catalog")
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

it("encodes catalog pagination and server search without changing field names", async () => {
  const body = {
    object: "event_catalog",
    has_more: true,
    next_cursor: "next page",
    data: [],
  }
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(body))
  vi.stubGlobal("fetch", fetcher)
  const result = await new Resend("fixture-token").events.catalog({
    limit: 3,
    after: "previous page",
    search: "paid & shipped",
  })
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.opensend.test/events/catalog?limit=3&after=previous+page&search=paid+%26+shipped"
  )
  expect(result.data).toEqual(body)
  expect(result.data?.object).toBe("event_catalog")
})
