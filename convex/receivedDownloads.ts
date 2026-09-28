import { SignJWT, jwtVerify } from "jose"
import type { HttpRouter } from "convex/server"
import { v } from "convex/values"
import {
  env,
  httpAction,
  internalQuery,
  type ActionCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { retirement } from "./teamLifecycle"

const PREFIX = "/receiving-files/"
const key = () => new TextEncoder().encode(env.BETTER_AUTH_SECRET)
export async function downloadLink(
  ctx: ActionCtx,
  emailId: Id<"receivedEmails">,
  attachmentId?: Id<"receivedAttachments">
) {
  const expires = Math.floor(Date.now() / 1000) + 3600
  const token = await new SignJWT({ emailId, attachmentId })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("received-file")
    .setExpirationTime(expires)
    .sign(key())
  const installation = await ctx.runQuery(internal.installation.connection, {})
  const origin = installation.callbackOrigin ?? env.CONVEX_SITE_URL
  return {
    download_url: `${origin}${PREFIX}${token}`,
    expires_at: new Date(expires * 1000).toISOString(),
  }
}
export const file = internalQuery({
  args: { emailId: v.string(), attachmentId: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      contentType: v.string(),
    })
  ),
  handler: async (ctx, args) => {
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
  try {
    const { payload } = await jwtVerify(
      new URL(request.url).pathname.slice(PREFIX.length),
      key(),
      { algorithms: ["HS256"], audience: "received-file" }
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
}
