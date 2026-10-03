import { afterEach, expect, it, vi } from "vitest"
import { connectClient } from "../helpers/client.js"
const clients: Awaited<ReturnType<typeof connectClient>>[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(clients.splice(0).map((c) => c.close()))
})
it("toolkit MCP forwards nested paths and typed field configuration through the real SDK", async () => {
  const connection = await connectClient("sk_fixture_not_a_real_key")
  clients.push(connection)
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json({ id: "created" }))
  vi.stubGlobal("fetch", fetch)
  const tools = (await connection.client.listTools()).tools
  expect(
    tools.find((t) => t.name === "search-knowledge")?.annotations?.readOnlyHint
  ).toBe(true)
  expect(
    tools.find((t) => t.name === "remove-bot-tool")?.annotations
      ?.destructiveHint
  ).toBe(true)
  expect(
    tools.find((t) => t.name === "test-bot-tool")?.annotations?.readOnlyHint
  ).toBe(false)
  await connection.client.callTool({
    name: "create-knowledge-document",
    arguments: {
      knowledgeBaseId: "kb/1",
      title: "Manual",
      source: "text",
      text: "Material",
      idempotencyKey: "once",
    },
  })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.opensend.test/knowledge-bases/kb%2F1/documents"
  )
  expect(
    new Headers(fetch.mock.calls.at(-1)![1].headers).get("Idempotency-Key")
  ).toBe("once")
  await connection.client.callTool({
    name: "test-bot-tool",
    arguments: { id: "tool/1", arguments: { guests: 0, confirmed: false } },
  })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.opensend.test/bot-tools/tool%2F1/test"
  )
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body)).toEqual({
    guests: 0,
    confirmed: false,
  })
  const collect = [
    {
      key: "guests",
      label: "Guests",
      description: "Ask how many",
      type: "number",
      required: true,
    },
  ]
  await connection.client.callTool({
    name: "update-voice-bot",
    arguments: {
      id: "bot",
      collect,
      knowledgeBaseIds: ["kb"],
      customToolIds: ["tool"],
    },
  })
  expect(JSON.parse(fetch.mock.calls.at(-1)![1].body).collect).toEqual(collect)
  const before = fetch.mock.calls.length
  expect(
    (
      await connection.client.callTool({
        name: "create-bot-tool",
        arguments: {
          name: "bad name",
          description: "Invalid",
          url: "https://example.test",
          parameters: { type: "object", properties: {} },
        },
      })
    ).isError
  ).toBe(true)
  expect(fetch.mock.calls.length).toBe(before)
})
