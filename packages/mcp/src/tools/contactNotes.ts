import type { McpServer } from "@modelcontextprotocol/server"
import type { Opensend } from "@opensendcc/sdk"
import { z } from "zod"
import {
  channelOutput,
  channelPagination,
  channelPageCheck,
} from "./channelMessaging.js"

export function addContactNoteTools(server: McpServer, opensend: Opensend) {
  const contactId = z.string().describe("Contact ID or email")
  const noteId = z.string().describe("Note ID belonging to this contact")
  const body = z
    .string()
    .min(1)
    .max(10000)
    .describe("Plain text note, up to 10,000 characters")
  const output = (result: { data: unknown; error: unknown }) =>
    channelOutput("Contact notes", result)
  server.registerTool(
    "list-contact-notes",
    {
      title: "List Contact Notes",
      description:
        "List a contact's notes, newest first, with authors and source links.",
      annotations: { readOnlyHint: true },
      inputSchema: { contactId, ...channelPagination },
    },
    async (input) => {
      channelPageCheck(input)
      return output(
        await opensend.contacts.notes.list(
          input as Parameters<typeof opensend.contacts.notes.list>[0]
        )
      )
    }
  )
  server.registerTool(
    "create-contact-note",
    {
      title: "Create Contact Note",
      description:
        "Save a plain text note on a contact. The API records the authenticated author.",
      annotations: { readOnlyHint: false, destructiveHint: false },
      inputSchema: {
        contactId,
        body,
        idempotencyKey: z.string().optional(),
        source: z
          .object({
            call_id: z.string().optional(),
            conversation_id: z.string().optional(),
            message_id: z.string().optional(),
          })
          .optional(),
      },
    },
    async ({ idempotencyKey, ...input }) =>
      output(await opensend.contacts.notes.create(input, { idempotencyKey }))
  )
  server.registerTool(
    "update-contact-note",
    {
      title: "Update Contact Note",
      description:
        "Edit a contact note's plain text body. Its author and source are preserved.",
      annotations: { readOnlyHint: false },
      inputSchema: { contactId, noteId, body },
    },
    async (input) => output(await opensend.contacts.notes.update(input))
  )
  server.registerTool(
    "remove-contact-note",
    {
      title: "Remove Contact Note",
      description: "Delete a note belonging to a contact.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      inputSchema: { contactId, noteId },
    },
    async (input) => output(await opensend.contacts.notes.remove(input))
  )
}
