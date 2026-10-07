import { afterEach, expect, it, vi } from "vitest"
import { SYSTEM_EVENT_CATALOG } from "@opensendcc/sdk"
import { connectClient } from "../helpers/client.js"

afterEach(() => vi.unstubAllGlobals())
it("lists and filters the shared catalog with nested contact note and call fields", async () => {
  const f = await connectClient()
  try {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        object: "event_catalog",
        has_more: false,
        next_cursor: null,
        data: SYSTEM_EVENT_CATALOG,
      })
    )
    vi.stubGlobal("fetch", fetcher)
    for (const event of [
      undefined,
      "contact.note_created",
      "opensend:whatsapp.call.completed",
    ]) {
      const result = await f.client.callTool({
        name: "list-event-catalog",
        arguments: event ? { event } : {},
      })
      expect(result.isError).not.toBe(true)
      const data = JSON.parse((result.content as { text: string }[])[0].text)
      expect(data).toEqual(
        SYSTEM_EVENT_CATALOG.filter(
          (item) => !event || item.name === event || item.trigger === event
        )
      )
    }
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.opensend.test/events/catalog"
    )
  } finally {
    await f.close()
  }
})
it("surfaces a denied catalog scope as a tool error", async () => {
  const f = await connectClient()
  try {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          { name: "restricted_api_key", message: "Missing events:read" },
          { status: 403 }
        )
      )
    )
    const result = await f.client.callTool({
      name: "list-event-catalog",
      arguments: {},
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain("Missing events:read")
  } finally {
    await f.close()
  }
})

it("forwards catalog page and search params and exposes continuation metadata", async () => {
  const f = await connectClient()
  try {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        object: "event_catalog",
        has_more: true,
        next_cursor: "next-page",
        data: [],
      })
    )
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name: "list-event-catalog",
      arguments: { limit: 2, after: "previous-page", search: "invoice paid" },
    })
    expect(result.isError).not.toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.opensend.test/events/catalog?limit=2&after=previous-page&search=invoice+paid"
    )
    expect(JSON.parse((result.content as { text: string }[])[1].text)).toEqual({
      object: "event_catalog",
      has_more: true,
      next_cursor: "next-page",
    })
    for (const limit of [0, 101, 1.5]) {
      const bad = await f.client.callTool({
        name: "list-event-catalog",
        arguments: { limit },
      })
      expect(bad.isError).toBe(true)
    }
  } finally {
    await f.close()
  }
})
it("looks up a requested custom event through server search", async () => {
  const f = await connectClient()
  try {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        object: "event_catalog",
        has_more: false,
        next_cursor: null,
        data: [{ name: "late.event", trigger: "late.event" }],
      })
    )
    vi.stubGlobal("fetch", fetcher)
    const result = await f.client.callTool({
      name: "list-event-catalog",
      arguments: { event: "late.event" },
    })
    expect(result.isError).not.toBe(true)
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.opensend.test/events/catalog?search=late.event"
    )
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual([
      { name: "late.event", trigger: "late.event" },
    ])
  } finally {
    await f.close()
  }
})
