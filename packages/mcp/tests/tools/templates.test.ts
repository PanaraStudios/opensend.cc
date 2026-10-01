import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addTemplateTools } from "../../src/tools/templates.js"

const create = vi.fn()
const update = vi.fn()
const list = vi.fn()
const get = vi.fn()

const resend = {
  templates: { create, update, list, get },
} as unknown as Opensend

async function makeClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" })
  addTemplateTools(server, resend)
  const client = new Client({ name: "test-client", version: "0.0.0" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

describe("template empty string fields", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    create.mockResolvedValue({
      data: { id: "tmpl_1" },
      error: null,
    })
    update.mockResolvedValue({
      data: { id: "tmpl_1" },
      error: null,
    })
  })

  it("passes empty text through create-template", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "create-template",
      arguments: {
        name: "Welcome",
        html: "<p>Hello</p>",
        text: "",
      },
    })

    expect(result.isError).toBeFalsy()
    expect(create).toHaveBeenCalledWith({
      name: "Welcome",
      html: "<p>Hello</p>",
      text: "",
    })
  })

  it("passes empty text through update-template", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "update-template",
      arguments: {
        id: "tmpl_1",
        text: "",
      },
    })

    expect(result.isError).toBeFalsy()
    expect(update).toHaveBeenCalledWith("tmpl_1", { text: "" })
  })

  it("passes empty subject through update-template", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "update-template",
      arguments: { id: "tmpl_1", subject: "" },
    })

    expect(result.isError).toBeFalsy()
    expect(update).toHaveBeenCalledWith("tmpl_1", { subject: "" })
  })
})

describe("WhatsApp templates", () => {
  const components = [
    {
      type: "BODY",
      text: "Your order {{1}} has shipped.",
      example: { body_text: [["860198"]] },
    },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    create.mockResolvedValue({ data: { id: "tmpl_wa" }, error: null })
    list.mockResolvedValue({
      data: {
        object: "list",
        has_more: false,
        data: [
          {
            id: "tmpl_wa",
            name: "order_shipped",
            status: "published",
            alias: "order-shipped",
            created_at: "2026-10-01 00:00:00.000000+00",
            channel: "whatsapp",
            whatsapp: { status: "APPROVED" },
          },
        ],
      },
      error: null,
    })
    get.mockResolvedValue({
      data: {
        id: "tmpl_wa",
        name: "order_shipped",
        status: "published",
        alias: "order-shipped",
        channel: "whatsapp",
        variables: [{ key: "1" }],
        whatsapp: {
          waba_id: "102290129340398",
          language: "en_US",
          category: "UTILITY",
          parameter_format: "positional",
          status: "REJECTED",
          rejected_reason: "INVALID_FORMAT",
          components,
        },
      },
      error: null,
    })
  })

  it("creates a WhatsApp template without html", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "create-template",
      arguments: {
        name: "order_shipped",
        channel: "whatsapp",
        whatsapp: { category: "UTILITY", components },
      },
    })
    expect(result.isError).toBeFalsy()
    expect(create).toHaveBeenCalledWith({
      name: "order_shipped",
      channel: "whatsapp",
      whatsapp: { category: "UTILITY", components },
    })
  })

  it("still requires html for an email template", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "create-template",
      arguments: { name: "Welcome" },
    })
    expect(result.isError).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })

  it("lists by channel and shows Meta's status", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "list-templates",
      arguments: { channel: "whatsapp" },
    })
    expect(list).toHaveBeenCalledWith({ channel: "whatsapp" })
    const text = JSON.stringify(result.content)
    expect(text).toContain("Channel: whatsapp")
    expect(text).toContain("Meta status: APPROVED")
  })

  it("shows a WhatsApp template's components and rejection", async () => {
    const client = await makeClient()
    const result = await client.callTool({
      name: "get-template",
      arguments: { id: "tmpl_wa" },
    })
    const text = JSON.stringify(result.content)
    expect(text).toContain("Rejected: INVALID_FORMAT")
    expect(text).toContain("Your order {{1}} has shipped.")
  })
})
