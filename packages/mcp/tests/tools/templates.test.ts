import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addTemplateTools } from "../../src/tools/templates.js"

const create = vi.fn()
const update = vi.fn()

const resend = {
  templates: { create, update },
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
