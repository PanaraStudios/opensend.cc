import { afterEach, expect, it, vi } from "vitest"
import { Opensend } from "../resend"
const client = new Opensend("sk_fixture_not_a_real_key", {
  baseUrl: "https://api.example.test",
})
afterEach(() => vi.unstubAllGlobals())
it("toolkit resources preserve bodies, idempotency, cursors, nested IDs and bot attachments", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () => Response.json({ id: "resource" }))
  vi.stubGlobal("fetch", fetch)
  const body = { name: "Knowledge", description: "Reference" }
  await client.knowledgeBases.create(body, { idempotencyKey: "once" })
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual(body)
  expect(
    new Headers(fetch.mock.calls[0][1]!.headers).get("Idempotency-Key")
  ).toBe("once")
  await client.knowledgeBases.list({ after: "a b", limit: 3 })
  expect(
    new URL(fetch.mock.calls.at(-1)![0] as string).searchParams.get("after")
  ).toBe("a b")
  await client.knowledgeBases.get("kb/1")
  await client.knowledgeBases.update("kb/1", { description: "Updated" })
  await client.knowledgeBases.documents.create("kb/1", {
    title: "Manual",
    source: "text",
    text: "Answers",
  })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/knowledge-bases/kb%2F1/documents"
  )
  await client.knowledgeBases.documents.list("kb/1", { limit: 2 })
  await client.knowledgeBases.documents.get("kb/1", "doc/1")
  await client.knowledgeBases.documents.update("kb/1", "doc/1", {
    text: "Edited",
  })
  await client.knowledgeBases.documents.remove("kb/1", "doc/1")
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/knowledge-bases/kb%2F1/documents/doc%2F1"
  )
  await client.knowledgeBases.search("kb/1", { query: "Question", limit: 5 })
  expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toEqual({
    query: "Question",
    limit: 5,
  })
  const tool = {
    name: "book_appointment",
    description: "Book an appointment",
    url: "https://example.test/book",
    headers: { authorization: "sk_fixture_not_a_real_key" },
    parameters: {
      type: "object" as const,
      properties: { guests: { type: "number" as const } },
      required: ["guests"],
    },
  }
  await client.botTools.create(tool)
  await client.botTools.list({ before: "tool 1" })
  await client.botTools.get("tool/1")
  await client.botTools.update("tool/1", { timeoutMs: 2000 })
  await client.botTools.test("tool/1", { guests: 0 })
  expect(fetch.mock.calls.at(-1)![0]).toBe(
    "https://api.example.test/bot-tools/tool%2F1/test"
  )
  expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toEqual({
    guests: 0,
  })
  await client.botTools.remove("tool/1")
  await client.knowledgeBases.remove("kb/1")
  await client.voiceBots.update("bot", {
    knowledgeBaseIds: ["kb"],
    customToolIds: ["tool"],
    collect: [
      {
        key: "guests",
        label: "Guests",
        description: "Ask how many",
        type: "number",
        required: true,
        contactProperty: "guests",
      },
    ],
  })
  expect(
    JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).collect[0]
      .contactProperty
  ).toBe("guests")
})
