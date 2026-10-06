import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { addAutomationTools } from "../../src/tools/automations.js"

const create = vi.fn()
const get = vi.fn()
const duplicate = vi.fn()

const resend = {
  automations: { create, get, duplicate },
} as unknown as Opensend

const workflow = {
  steps: [
    {
      key: "trigger",
      type: "trigger",
      config: { eventName: "user.created" },
      next: null,
    },
  ],
}

async function makeClient() {
  const server = new McpServer({ name: "test", version: "0.0.0" })
  addAutomationTools(server, resend)
  const client = new Client({ name: "test-client", version: "0.0.0" })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

describe("automation REST results", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns the resource ID on create-automation", async () => {
    create.mockResolvedValue({ data: { id: "aut_1" }, error: null })
    const client = await makeClient()

    const result = await client.callTool({
      name: "create-automation",
      arguments: { name: "Welcome Series", workflow },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)
      .map((c) => c.text)
      .join("\n")
    expect(text).toContain("ID: aut_1")
  })

  it("returns the resource ID on get-automation", async () => {
    get.mockResolvedValue({
      data: {
        id: "aut_1",
        name: "Welcome Series",
        status: "enabled",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: null,
        steps: [],
        connections: [],
      },
      error: null,
    })
    const client = await makeClient()

    const result = await client.callTool({
      name: "get-automation",
      arguments: { id: "aut_1" },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)
      .map((c) => c.text)
      .join("\n")
    expect(text).toContain("ID: aut_1")
  })

  it("returns the resource ID on duplicate-automation", async () => {
    duplicate.mockResolvedValue({ data: { id: "aut_2" }, error: null })
    const client = await makeClient()

    const result = await client.callTool({
      name: "duplicate-automation",
      arguments: { id: "aut_1" },
    })

    expect(result.isError).toBeFalsy()
    const text = (result.content as Array<{ type: string; text: string }>)
      .map((c) => c.text)
      .join("\n")
    expect(text).toContain("ID: aut_2")
  })
})

it("documents Page send constraints and passes Messenger/Instagram shapes to the SDK", async () => {
  create.mockResolvedValue({ data: { id: "aut_pages" }, error: null })
  const client = await makeClient()
  const tools = await client.listTools()
  const guidance = tools.tools.find(
    (tool) => tool.name === "create-automation"
  )!.description!
  for (const text of [
    "send_messenger",
    "send_instagram",
    "no_channel_identity",
    "window_closed",
    "HUMAN_AGENT",
  ])
    expect(guidance).toContain(text)
  const steps = [
    {
      key: "start",
      type: "trigger",
      config: { eventName: "opensend:messenger.message.received" },
      next: "messenger",
    },
    {
      key: "messenger",
      type: "send_messenger",
      config: { accountId: "page", mode: "text", text: "Reply" },
      next: "instagram",
    },
    {
      key: "instagram",
      type: "send_instagram",
      config: {
        accountId: "ig",
        mode: "template",
        templateId: "published",
        variables: { name: { contact: "firstName" } },
      },
      next: null,
    },
  ]
  const result = await client.callTool({
    name: "create-automation",
    arguments: { name: "Page replies", workflow: { steps } },
  })
  expect(result.isError).toBeFalsy()
  expect(create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      steps: steps.map(({ next: _next, ...step }) => {
        void _next
        return step
      }),
    }),
    { idempotencyKey: undefined }
  )
})
