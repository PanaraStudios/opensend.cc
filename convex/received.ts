import { v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import { stream } from "convex-helpers/server/stream"
import {
  query,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import schema from "./schema"
import { requireTeam } from "./access"
import { countValue, counters, insertRow, deleteRow } from "./counts"
import { filteredPage, matchesSearch } from "./lists"
import {
  receivedMetadata,
  receivedContent,
  receivedAttachment,
} from "./tables/received"
import { emitEvent } from "./events"
import { retirement } from "./teamLifecycle"

export const MAX_RECEIVED_ATTACHMENTS = 100
export const RECEIVED_RETENTION = 30 * 86400000
export const receivedFilters = v.object({
  search: v.optional(v.string()),
  from: v.optional(v.number()),
  to: v.optional(v.number()),
  address: v.optional(v.string()),
})
export function receivedPage(
  ctx: QueryCtx,
  args: Infer<typeof receivedFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const rows = stream(ctx.db, schema).query("receivedEmails")
  const from = args.from ?? 0
  const to = args.to ?? Number.MAX_SAFE_INTEGER
  const scoped =
    args.address === undefined
      ? rows.withIndex("by_organizationId_and_receivedAt", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .gte("receivedAt", from)
            .lte("receivedAt", to)
        )
      : rows.withIndex("by_organizationId_and_sender_and_receivedAt", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("sender", args.address!.trim().toLowerCase())
            .gte("receivedAt", from)
            .lte("receivedAt", to)
        )
  const matches = matchesSearch(args.search)
  return filteredPage(
    scoped.order("desc"),
    args.paginationOpts,
    (row) => matches(row.from, row.subject, ...row.to),
    { rows: 100, bytes: 1024 * 1024 },
    args.search
  )
}
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...receivedFilters.fields,
  },
  returns: paginationResultValidator(schema.doc("receivedEmails")),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    return receivedPage(ctx, args)
  },
})
export const count = query({
  args: { organizationId: v.string(), ...receivedFilters.fields },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "read")
    return {
      total:
        args.search?.trim() || args.address !== undefined
          ? null
          : await counters.receivedEmails.total(
              ctx,
              args.organizationId,
              [],
              args
            ),
    }
  },
})
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      email: schema.doc("receivedEmails"),
      content: v.union(v.null(), schema.doc("receivedContents")),
    })
  ),
  handler: async (ctx, { id }) => {
    const normalized = ctx.db.normalizeId("receivedEmails", id)
    const email = normalized
      ? await ctx.db.get("receivedEmails", normalized)
      : null
    if (!email) return null
    await requireTeam(ctx, email.organizationId, "read")
    const content = await ctx.db
      .query("receivedContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
      .unique()
    return { email, content }
  },
})
export const receivingDomain = query({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    const domain = await ctx.db
      .query("domains")
      .withIndex("by_organizationId_and_deleted_and_receiving", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("deleted", false)
          .eq("receiving", true)
      )
      .first()
    return domain ? { name: domain.name } : null
  },
})
export function attachmentMetadata(row: Doc<"receivedAttachments">) {
  return {
    id: row._id,
    filename: row.filename,
    content_type: row.contentType,
    content_disposition: row.contentDisposition,
    content_id: row.contentId,
    size: row.size,
  }
}
export const parseSource = internalQuery({
  args: { id: v.id("inboundMessages") },
  returns: v.union(schema.doc("inboundMessages"), v.null()),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("inboundMessages", id)
    return !row ||
      row.parsedAt !== undefined ||
      (await retirement(ctx, row.organizationId))
      ? null
      : row
  },
})
export const complete = internalMutation({
  args: {
    id: v.id("inboundMessages"),
    metadata: receivedMetadata,
    content: receivedContent,
    attachments: v.array(receivedAttachment),
    parseError: v.optional(v.string()),
  },
  returns: v.union(v.id("receivedEmails"), v.null()),
  handler: async (ctx, args) => {
    const inbound = await ctx.db.get("inboundMessages", args.id)
    if (
      !inbound?.storageId ||
      inbound.parsedAt !== undefined ||
      (await retirement(ctx, inbound.organizationId))
    )
      return null
    if (args.attachments.length > MAX_RECEIVED_ATTACHMENTS)
      throw new Error("Too many attachments")
    // Authentication verdicts come from SES; forwarded recipients come from Received headers.
    const notification = JSON.parse(inbound.notification)
    const receipt = notification.receipt ?? {}
    const receivedFor = [
      ...new Set(
        Array.from(
          (args.content.headers.received ?? "").matchAll(
            /\bfor\s+<?([^\s<>;]+@[^\s<>;]+)>?/gi
          ),
          (match) => match[1]
        ).filter((address) => address.length <= 320)
      ),
    ].slice(0, 50)
    const authentication: Record<string, string> = {}
    for (const name of ["spf", "dkim", "dmarc"])
      if (typeof receipt[`${name}Verdict`]?.status === "string")
        authentication[name] = receipt[`${name}Verdict`].status.toLowerCase()
    const id = await insertRow(ctx, "receivedEmails", {
      organizationId: inbound.organizationId,
      inboundId: args.id,
      domainId: inbound.domainId,
      ...args.metadata,
      receivedFor,
      authentication,
      receivedAt: inbound._creationTime,
      expiresAt: inbound._creationTime + RECEIVED_RETENTION,
      rawId: inbound.storageId,
      parseError: args.parseError,
    })
    await ctx.db.insert("receivedContents", { emailId: id, ...args.content })
    const attachments = []
    for (const attachment of args.attachments) {
      const attachmentId = await ctx.db.insert("receivedAttachments", {
        emailId: id,
        ...attachment,
      })
      const metadata = attachmentMetadata(
        (await ctx.db.get("receivedAttachments", attachmentId))!
      )
      attachments.push({
        id: metadata.id,
        filename: metadata.filename,
        content_type: metadata.content_type,
        content_disposition: metadata.content_disposition,
        content_id: metadata.content_id,
      })
    }
    await ctx.db.patch("inboundMessages", args.id, {
      parsedAt: Date.now(),
      notification: "",
    })
    await emitEvent(ctx, inbound.organizationId, "email.received", {
      email_id: id,
      created_at: new Date(inbound._creationTime).toISOString(),
      from: args.metadata.from,
      to: args.metadata.to,
      cc: args.metadata.cc,
      bcc: args.metadata.bcc,
      received_for: receivedFor,
      message_id: args.metadata.messageId,
      subject: args.metadata.subject,
      attachments,
    })
    return id
  },
})
/** Bounded by the parser's attachment limit; shared with team erasure. */
export async function deleteReceived(
  ctx: MutationCtx,
  email: Doc<"receivedEmails">
) {
  const attachments = await ctx.db
    .query("receivedAttachments")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .take(MAX_RECEIVED_ATTACHMENTS)
  for (const file of attachments) {
    await ctx.storage.delete(file.storageId)
    await ctx.db.delete("receivedAttachments", file._id)
  }
  const content = await ctx.db
    .query("receivedContents")
    .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
    .unique()
  if (content) await ctx.db.delete("receivedContents", content._id)
  await ctx.storage.delete(email.rawId)
  // Keep the SNS deduplication tombstone so a retry cannot resurrect expired mail.
  const inbound = await ctx.db.get("inboundMessages", email.inboundId)
  if (inbound)
    await ctx.db.patch("inboundMessages", inbound._id, { storageId: undefined })
  await deleteRow(ctx, "receivedEmails", email._id)
}
export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const email = await ctx.db
      .query("receivedEmails")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .first()
    if (email) {
      await deleteReceived(ctx, email)
      await ctx.scheduler.runAfter(0, internal.received.prune, {})
    }
    return null
  },
})
