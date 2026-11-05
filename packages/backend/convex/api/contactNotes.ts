import { stream } from "convex-helpers/server/stream"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import { createNote, notePayload, updateNote } from "../contactNotes"
import schema from "../schema"
import { own } from "./audience"
import { callerValue, invalid, notFound, requireCaller } from "./caller"
import { idempotent } from "./idempotency"
import { cursorPage, listArgs } from "./paging"
import {
  apiRoute,
  listBody,
  listParams,
  objectBody,
  stringField,
} from "./route"
import type { Doc } from "../_generated/dataModel"

async function ownNote(ctx: QueryCtx, contact: Doc<"contacts">, value: string) {
  const id = ctx.db.normalizeId("contactNotes", value)
  const note = id ? await ctx.db.get("contactNotes", id) : null
  if (
    !note ||
    note.organizationId !== contact.organizationId ||
    note.contactId !== contact._id
  )
    throw notFound("Contact note")
  return note
}
export const list = internalQuery({
  args: { caller: callerValue, id: v.string(), ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("contactNotes")),
  }),
  handler: async (ctx, { caller, id, ...page }) => {
    await requireCaller(ctx, caller, { resource: "contacts", access: "read" })
    const contact = await own(ctx, "contacts", caller.organizationId, id)
    return cursorPage(
      page,
      async (anchor) => {
        try {
          return await ownNote(ctx, contact, anchor)
        } catch {
          return null
        }
      },
      (order) =>
        stream(ctx.db, schema)
          .query("contactNotes")
          .withIndex("by_organizationId_and_contactId", (q) =>
            q
              .eq("organizationId", caller.organizationId)
              .eq("contactId", contact._id)
          )
          .order(order)
    )
  },
})
export const create = internalMutation({
  args: { caller: callerValue, id: v.string(), body: v.string() },
  returns: schema.doc("contactNotes"),
  handler: async (ctx, { caller, id, body }) =>
    idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller, {
          resource: "contacts",
          access: "write",
        })
        const contact = await own(ctx, "contacts", caller.organizationId, id)
        const input = objectBody(JSON.parse(body))
        const source =
          input.source === undefined ? undefined : objectBody(input.source)
        const sourceId = <
          T extends "calls" | "conversations" | "channelMessages",
        >(
          table: T,
          field: string
        ) => {
          const value = source && stringField(source, field)
          if (value === undefined) return undefined
          const normalized = ctx.db.normalizeId(table, value)
          if (!normalized) throw invalid(`Invalid ${field}`)
          return normalized
        }
        return createNote(ctx, contact, {
          body: stringField(input, "body", true)!,
          author: {
            kind: "api",
            id: caller.apiKeyId ?? caller.oauthGrantId,
            name: caller.name,
          },
          ...(source
            ? {
                source: {
                  callId: sourceId("calls", "call_id"),
                  conversationId: sourceId("conversations", "conversation_id"),
                  messageId: sourceId("channelMessages", "message_id"),
                },
              }
            : {}),
        })
      },
      (note) => ({ status: 201, body: notePayload(note) })
    ),
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    noteId: v.string(),
    remove: v.boolean(),
    body: v.string(),
  },
  returns: schema.doc("contactNotes"),
  handler: async (ctx, { caller, id, noteId, remove, body }) => {
    await requireCaller(ctx, caller, { resource: "contacts", access: "write" })
    const contact = await own(ctx, "contacts", caller.organizationId, id)
    const note = await ownNote(ctx, contact, noteId)
    if (remove) {
      await ctx.db.delete("contactNotes", note._id)
      return note
    }
    return updateNote(
      ctx,
      note,
      stringField(objectBody(JSON.parse(body)), "body", true)!
    )
  },
})
export function registerContactNoteRoutes(http: HttpRouter) {
  const path = "/contacts/{id}/notes"
  apiRoute(http, {
    method: "GET",
    path,
    scope: { resource: "contacts", access: "read" },
    handler: async (ctx, { caller, params, query }) => ({
      body: listBody(
        await ctx.runQuery(internal.api.contactNotes.list, {
          caller,
          id: params.id,
          ...listParams(query),
        }),
        notePayload
      ),
    }),
  })
  apiRoute(http, {
    method: "POST",
    path,
    scope: { resource: "contacts", access: "write" },
    handler: async (ctx, { caller, params, body }) => ({
      status: 201,
      body: notePayload(
        await ctx.runMutation(internal.api.contactNotes.create, {
          caller,
          id: params.id,
          body: JSON.stringify(body ?? {}),
        })
      ),
    }),
  })
  for (const method of ["PATCH", "DELETE"] as const)
    apiRoute(http, {
      method,
      path: `${path}/{note_id}`,
      scope: { resource: "contacts", access: "write" },
      handler: async (ctx, { caller, params, body }) => {
        const note = await ctx.runMutation(internal.api.contactNotes.change, {
          caller,
          id: params.id,
          noteId: params.note_id,
          remove: method === "DELETE",
          body: JSON.stringify(body ?? {}),
        })
        return {
          body:
            method === "DELETE"
              ? { object: "contact_note", id: note._id, deleted: true }
              : notePayload(note),
        }
      },
    })
}
