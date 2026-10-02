import { Client } from "@modelcontextprotocol/client"
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { afterEach, expect, it, vi } from "vitest"
import { addContactNoteTools } from "../../src/tools/contactNotes.js"

const notes = {
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}
const opensend = { contacts: { notes } } as unknown as Opensend
const clients: Client[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(clients.splice(0).map((c) => c.close()))
})
async function client() {
  const server = new McpServer({ name: "notes", version: "0.0.0" })
  addContactNoteTools(server, opensend)
  const client = new Client({ name: "test", version: "0.0.0" })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(b), client.connect(a)])
  clients.push(client)
  return client
}
it("registers note CRUD with read and destructive annotations, and forwards SDK inputs", async () => {
  const c = await client()
  const tools = (await c.listTools()).tools
  expect(tools.map((t) => t.name).sort()).toEqual([
    "create-contact-note",
    "list-contact-notes",
    "remove-contact-note",
    "update-contact-note",
  ])
  expect(
    tools.find((t) => t.name === "list-contact-notes")!.annotations
      ?.readOnlyHint
  ).toBe(true)
  expect(
    tools.find((t) => t.name === "remove-contact-note")!.annotations
      ?.destructiveHint
  ).toBe(true)
  for (const method of Object.values(notes))
    method.mockResolvedValue({ data: { id: "note" }, error: null })
  await c.callTool({
    name: "create-contact-note",
    arguments: {
      contactId: "contact",
      body: "Follow up",
      source: { call_id: "call" },
      idempotencyKey: "once",
    },
  })
  expect(notes.create).toHaveBeenCalledWith(
    { contactId: "contact", body: "Follow up", source: { call_id: "call" } },
    { idempotencyKey: "once" }
  )
  await c.callTool({
    name: "list-contact-notes",
    arguments: { contactId: "contact", limit: 5, after: "anchor" },
  })
  expect(notes.list).toHaveBeenCalledWith({
    contactId: "contact",
    limit: 5,
    after: "anchor",
  })
  await c.callTool({
    name: "update-contact-note",
    arguments: { contactId: "contact", noteId: "note", body: "Edited" },
  })
  expect(notes.update).toHaveBeenCalledWith({
    contactId: "contact",
    noteId: "note",
    body: "Edited",
  })
  await c.callTool({
    name: "remove-contact-note",
    arguments: { contactId: "contact", noteId: "note" },
  })
  expect(notes.remove).toHaveBeenCalledWith({
    contactId: "contact",
    noteId: "note",
  })
})
it("rejects oversized bodies and conflicting cursors, and surfaces API failures", async () => {
  const c = await client()
  const invalid = await c.callTool({
    name: "create-contact-note",
    arguments: { contactId: "contact", body: "x".repeat(10001) },
  })
  expect(invalid.isError).toBe(true)
  expect(notes.create).not.toHaveBeenCalled()
  const page = await c.callTool({
    name: "list-contact-notes",
    arguments: { contactId: "contact", after: "a", before: "b" },
  })
  expect(page.isError).toBe(true)
  expect(notes.list).not.toHaveBeenCalled()
  notes.remove.mockResolvedValue({
    data: null,
    error: { message: "Contact note not found" },
  })
  const failed = await c.callTool({
    name: "remove-contact-note",
    arguments: { contactId: "foreign", noteId: "note" },
  })
  expect(failed.isError).toBe(true)
})
