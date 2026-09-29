import { stream } from "convex-helpers/server/stream"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import {
  internalQuery,
  type QueryCtx,
  type ActionCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import schema from "../schema"
import {
  callerValue,
  requireCaller,
  notFound,
  apiError,
  type Caller,
} from "./caller"
import { cursorPage, listArgs } from "./paging"
import { apiRoute, listParams } from "./route"
import { attachmentMetadata, MAX_RECEIVED_ATTACHMENTS } from "../received"
import { downloadLink } from "../receivedDownloads"

async function own(ctx: QueryCtx, caller: Caller, id: string) {
  const normalized = ctx.db.normalizeId("receivedEmails", id)
  const row = normalized ? await ctx.db.get("receivedEmails", normalized) : null
  return row?.organizationId === caller.organizationId ? row : null
}
const files = (ctx: QueryCtx, emailId: Doc<"receivedEmails">["_id"]) =>
  ctx.db
    .query("receivedAttachments")
    .withIndex("by_emailId", (q) => q.eq("emailId", emailId))
    .take(MAX_RECEIVED_ATTACHMENTS)
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(
      v.object({
        email: schema.doc("receivedEmails"),
        attachments: v.array(schema.doc("receivedAttachments")),
      })
    ),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    const result = await cursorPage(
      page,
      async (id) => await own(ctx, caller, id),
      (order) =>
        stream(ctx.db, schema)
          .query("receivedEmails")
          .withIndex("by_organizationId_and_receivedAt", (q) => {
            return q.eq("organizationId", caller.organizationId)
          })
          .order(order)
    )
    const data = []
    for (const email of result.data)
      data.push({ email, attachments: await files(ctx, email._id) })
    return { ...result, data }
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      email: schema.doc("receivedEmails"),
      content: v.union(v.null(), schema.doc("receivedContents")),
      attachments: v.array(schema.doc("receivedAttachments")),
    })
  ),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const email = await own(ctx, caller, id)
    if (!email) return null
    const content = await ctx.db
      .query("receivedContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
      .unique()
    return { email, content, attachments: await files(ctx, email._id) }
  },
})
export const attachments = internalQuery({
  args: {
    caller: callerValue,
    id: v.string(),
    attachmentId: v.optional(v.string()),
    ...listArgs,
  },
  returns: v.union(
    v.null(),
    v.object({
      emailId: v.id("receivedEmails"),
      has_more: v.boolean(),
      data: v.array(schema.doc("receivedAttachments")),
    })
  ),
  handler: async (ctx, { caller, id, attachmentId, ...page }) => {
    await requireCaller(ctx, caller)
    const email = await own(ctx, caller, id)
    if (!email) return null
    const ownFile = async (value: string) => {
      const normalized = ctx.db.normalizeId("receivedAttachments", value)
      const file = normalized
        ? await ctx.db.get("receivedAttachments", normalized)
        : null
      return file?.emailId === email._id ? file : null
    }
    if (attachmentId) {
      const file = await ownFile(attachmentId)
      return file ? { emailId: email._id, has_more: false, data: [file] } : null
    }
    const result = await cursorPage(
      page,
      async (value) => await ownFile(value),
      (order) =>
        stream(ctx.db, schema)
          .query("receivedAttachments")
          .withIndex("by_emailId", (q) => {
            return q.eq("emailId", email._id)
          })
          .order(order)
    )
    return { emailId: email._id, ...result }
  },
})
function summary(
  email: Doc<"receivedEmails">,
  attachments: Doc<"receivedAttachments">[]
) {
  return {
    id: email._id,
    to: email.to,
    from: email.from,
    created_at: new Date(email.receivedAt).toISOString(),
    subject: email.subject,
    bcc: email.bcc,
    cc: email.cc,
    reply_to: email.replyTo,
    message_id: email.messageId,
    attachments: attachments.map(attachmentMetadata),
  }
}
async function inlineHtml(
  ctx: ActionCtx,
  html: string,
  attachments: Doc<"receivedAttachments">[]
) {
  let result = html
  for (const file of attachments) {
    if (!file.contentId || !file.contentType.startsWith("image/")) continue
    const cid = `cid:${file.contentId}`
    if (!result.includes(cid)) continue
    // Leave room for metadata and JSON below Convex's 20 MiB HTTP limit.
    if (file.size > 6 * 1024 * 1024) return { html, html_format: "cid" }
    const blob = await ctx.storage.get(file.storageId)
    if (!blob) continue
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    for (let offset = 0; offset < bytes.length; offset += 8192)
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
    const uri = `data:${file.contentType};base64,${btoa(binary)}`
    // Match a whole cid attribute, not the prefix of another content id.
    const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const pattern = new RegExp(`${escaped}(?=["'\\s>]|$)`, "g")
    const occurrences = [...result.matchAll(pattern)].length
    if (result.length + occurrences * uri.length > 8 * 1024 * 1024)
      return { html, html_format: "cid" }
    result = result.replace(pattern, () => uri)
  }
  return { html: result || null, html_format: "data_uri" }
}
export function registerReceivedRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/emails/receiving",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const result = await ctx.runQuery(internal.api.received.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: result.has_more,
          data: result.data.map(({ email, attachments }) =>
            summary(email, attachments)
          ),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/emails/receiving/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params, query }) => {
      const format = query.get("html_format") ?? "data_uri"
      if (format !== "cid" && format !== "data_uri")
        throw apiError(422, "validation_error", "Invalid html_format")
      const result = await ctx.runQuery(internal.api.received.get, {
        caller,
        id: params.id,
      })
      if (!result) throw notFound("Email")
      return {
        body: {
          object: "email",
          ...summary(result.email, result.attachments),
          ...(format === "cid"
            ? { html: result.content?.html || null, html_format: "cid" }
            : await inlineHtml(
                ctx,
                result.content?.html ?? "",
                result.attachments
              )),
          text: result.content?.text || null,
          headers: result.content?.headers ?? {},
          received_for: result.email.receivedFor,
          authentication: Object.keys(result.email.authentication).length
            ? result.email.authentication
            : null,
          raw: await downloadLink(ctx, result.email._id),
        },
      }
    },
  })
  for (const single of [false, true])
    apiRoute(http, {
      method: "GET",
      path: `/emails/receiving/{id}/attachments${single ? "/{attachmentId}" : ""}`,
      permission: "full_access",
      handler: async (ctx, { caller, params, query }) => {
        const result = await ctx.runQuery(internal.api.received.attachments, {
          caller,
          id: params.id,
          attachmentId: params.attachmentId,
          ...(single ? { limit: 1 } : listParams(query)),
        })
        if (!result) throw notFound(single ? "Attachment" : "Email")
        const data = []
        for (const file of result.data)
          data.push({
            ...attachmentMetadata(file),
            ...(await downloadLink(ctx, result.emailId, file._id)),
          })
        return {
          body: single
            ? { object: "attachment", ...data[0] }
            : { object: "list", has_more: result.has_more, data },
        }
      },
    })
}
