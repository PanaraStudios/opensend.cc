import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { ConvexError, v } from "convex/values"
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { requireTeam } from "./access"
import { emitEvent } from "./events"
import schema from "./schema"

export const MAX_NOTE_LENGTH = 10_000
export function noteBody(body: string) {
  if (!body.trim() || body.length > MAX_NOTE_LENGTH)
    throw new ConvexError(
      `Enter a note between 1 and ${MAX_NOTE_LENGTH} characters`
    )
  return body
}

export function notePayload(note: Doc<"contactNotes">) {
  return {
    object: "contact_note" as const,
    id: note._id,
    contact_id: note.contactId,
    body: note.body,
    author: note.author,
    source: note.source
      ? {
          ...(note.source.callId ? { call_id: note.source.callId } : {}),
          ...(note.source.conversationId
            ? { conversation_id: note.source.conversationId }
            : {}),
          ...(note.source.messageId
            ? { message_id: note.source.messageId }
            : {}),
        }
      : null,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString(),
  }
}

export async function createNote(
  ctx: MutationCtx,
  contact: Doc<"contacts">,
  input: Pick<Doc<"contactNotes">, "body" | "author" | "source">
) {
  const body = noteBody(input.body)
  // References are metadata, but must never link another organization's data.
  for (const [table, id] of [
    ["calls", input.source?.callId],
    ["conversations", input.source?.conversationId],
    ["channelMessages", input.source?.messageId],
  ] as const) {
    if (id) {
      const row = await ctx.db.get(table, id)
      if (!row || row.organizationId !== contact.organizationId)
        throw new ConvexError(`Note ${table} source not found`)
    }
  }
  const now = Date.now()
  const id = await ctx.db.insert("contactNotes", {
    organizationId: contact.organizationId,
    contactId: contact._id,
    body,
    author: input.author,
    ...(input.source ? { source: input.source } : {}),
    createdAt: now,
    updatedAt: now,
  })
  const note = (await ctx.db.get("contactNotes", id))!
  await emitEvent(
    ctx,
    contact.organizationId,
    "contact.note_created",
    notePayload(note)
  )
  return note
}

export async function updateNote(
  ctx: MutationCtx,
  note: Doc<"contactNotes">,
  body: string
) {
  await ctx.db.patch("contactNotes", note._id, {
    body: noteBody(body),
    updatedAt: Date.now(),
  })
  return (await ctx.db.get("contactNotes", note._id))!
}
async function contactAccess(
  ctx: QueryCtx | MutationCtx,
  id: Id<"contacts">,
  access: "read" | "write"
) {
  const contact = await ctx.db.get("contacts", id)
  if (!contact) throw new ConvexError("Contact not found")
  await requireTeam(ctx, contact.organizationId, access)
  return contact
}
export const list = query({
  args: {
    contactId: v.id("contacts"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(schema.doc("contactNotes")),
  handler: async (ctx, { contactId, paginationOpts }) => {
    const contact = await contactAccess(ctx, contactId, "read")
    return ctx.db
      .query("contactNotes")
      .withIndex("by_organizationId_and_contactId", (q) =>
        q
          .eq("organizationId", contact.organizationId)
          .eq("contactId", contactId)
      )
      .order("desc")
      .paginate(paginationOpts)
  },
})
export const create = mutation({
  args: { contactId: v.id("contacts"), body: v.string() },
  returns: v.id("contactNotes"),
  handler: async (ctx, { contactId, body }) => {
    const contact = await contactAccess(ctx, contactId, "write")
    const identity = (await ctx.auth.getUserIdentity())!
    return (
      await createNote(ctx, contact, {
        body,
        author: {
          kind: "user",
          id: identity.tokenIdentifier,
          ...(identity.name ? { name: identity.name } : {}),
        },
      })
    )._id
  },
})
async function writableNote(ctx: MutationCtx, id: Id<"contactNotes">) {
  const note = await ctx.db.get("contactNotes", id)
  if (!note) throw new ConvexError("Note not found")
  const contact = await contactAccess(ctx, note.contactId, "write")
  if (note.organizationId !== contact.organizationId)
    throw new ConvexError("Note not found")
  return note
}
export const update = mutation({
  args: { id: v.id("contactNotes"), body: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, body }) => {
    await updateNote(ctx, await writableNote(ctx, id), body)
    return null
  },
})
export const remove = mutation({
  args: { id: v.id("contactNotes") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await writableNote(ctx, id)
    await ctx.db.delete("contactNotes", id)
    return null
  },
})
