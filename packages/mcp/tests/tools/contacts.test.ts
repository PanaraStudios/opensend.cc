import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"

const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal("fetch", fetchMock))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it("creates phone-only contacts, updates phones and displays nullable identities", async () => {
  const connection = await connectClient()
  try {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ object: "contact", id: "phone-contact" }))
    )
    const created = await connection.client.callTool({
      name: "create-contact",
      arguments: { phone: "+14155552671" },
    })
    expect(JSON.stringify(created)).toContain("Contact created successfully")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      phone: "+14155552671",
    })
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ object: "contact", id: "phone-contact" }))
    )
    await connection.client.callTool({
      name: "update-contact",
      arguments: { id: "phone-contact", phone: "+442079460958" },
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      phone: "+442079460958",
    })
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "contact",
          id: "phone-contact",
          email: null,
          phone: "+442079460958",
          first_name: null,
          last_name: null,
          unsubscribed: false,
          properties: {},
        })
      )
    )
    const contact = await connection.client.callTool({
      name: "get-contact",
      arguments: { id: "phone-contact" },
    })
    expect(JSON.stringify(contact)).toContain("Phone: +442079460958")
    expect(JSON.stringify(contact)).toContain("Email: —")
  } finally {
    await connection.close()
  }
})

it("passes mapped phone columns through contact imports", async () => {
  const connection = await connectClient()
  try {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ object: "contact_import", id: "phone-import" })
      )
    )
    await connection.client.callTool({
      name: "create-contact-import",
      arguments: {
        content: "Number\n+14155552671",
        columnMap: { phone: "Number" },
      },
    })
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(JSON.parse(body.get("column_map") as string)).toEqual({
      phone: "Number",
    })
  } finally {
    await connection.close()
  }
})
