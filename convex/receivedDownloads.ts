import { signedFileLink, verifyFileToken } from "./fileDownloads"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"
import { httpAction, internalQuery, type ActionCtx } from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { retirement } from "./teamLifecycle"

const PREFIX = "/receiving-files/"
const SENT_PREFIX = "/email-files/"
export const sentAttachmentId = (emailId: string, index: number) =>
  `${emailId}_${index}`
export async function downloadLink(
  ctx: ActionCtx,
  emailId: Id<"receivedEmails"> | Id<"emails">,
  attachmentId?: string,
  outbound = false
) {
  return signedFileLink(
    ctx,
    outbound ? SENT_PREFIX : PREFIX,
    outbound ? "sent-file" : "received-file",
    { emailId, attachmentId, outbound }
  )
}
export const file = internalQuery({
  args: {
    emailId: v.string(),
    attachmentId: v.optional(v.string()),
    outbound: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      contentType: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    if (args.outbound) {
      const id = ctx.db.normalizeId("emails", args.emailId)
      const email = id ? await ctx.db.get("emails", id) : null
      if (
        !email ||
        (email.expiresAt !== undefined && email.expiresAt <= Date.now()) ||
        (await retirement(ctx, email.organizationId))
      )
        return null
      const content = await ctx.db
        .query("emailContents")
        .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
        .unique()
      const file = content?.attachments?.find(
        (_, index) => sentAttachmentId(email._id, index) === args.attachmentId
      )
      return file
        ? {
            storageId: file.storageId,
            filename: file.filename,
            contentType: file.contentType,
          }
        : null
    }
    const id = ctx.db.normalizeId("receivedEmails", args.emailId)
    const email = id ? await ctx.db.get("receivedEmails", id) : null
    if (
      !email ||
      email.expiresAt <= Date.now() ||
      (await retirement(ctx, email.organizationId))
    )
      return null
    if (!args.attachmentId)
      return {
        storageId: email.rawId,
        filename: "message.eml",
        contentType: "message/rfc822",
      }
    const attachmentId = ctx.db.normalizeId(
      "receivedAttachments",
      args.attachmentId
    )
    const attachment = attachmentId
      ? await ctx.db.get("receivedAttachments", attachmentId)
      : null
    return attachment?.emailId === email._id
      ? {
          storageId: attachment.storageId,
          filename: attachment.filename ?? "attachment",
          contentType: attachment.contentType,
        }
      : null
  },
})
export const download = httpAction(async (ctx, request) => {
  let emailId: string, attachmentId: string | undefined
  const pathname = new URL(request.url).pathname
  const outbound = pathname.startsWith(SENT_PREFIX)
  try {
    const payload = await verifyFileToken(
      pathname.slice(outbound ? SENT_PREFIX.length : PREFIX.length),
      outbound ? "sent-file" : "received-file"
    )
    if (
      typeof payload.emailId !== "string" ||
      (payload.attachmentId !== undefined &&
        typeof payload.attachmentId !== "string")
    )
      throw new Error("Invalid file token")
    emailId = payload.emailId
    attachmentId = payload.attachmentId as string | undefined
  } catch {
    return new Response(null, { status: 404 })
  }
  const file = await ctx.runQuery(internal.receivedDownloads.file, {
    emailId,
    attachmentId,
    outbound,
  })
  if (!file) return new Response(null, { status: 404 })
  const blob = await ctx.storage.get(file.storageId)
  if (!blob) return new Response(null, { status: 404 })
  // Proxy the file: redirecting would disclose a permanent Convex storage URL.
  return new Response(blob, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
})
export function registerReceivedDownloadRoutes(http: HttpRouter) {
  http.route({ method: "GET", pathPrefix: PREFIX, handler: download })
  http.route({ method: "GET", pathPrefix: SENT_PREFIX, handler: download })
}
