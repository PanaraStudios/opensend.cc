import { Workpool, vOnCompleteArgs } from "@convex-dev/workpool"
import { components, internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import schema from "../schema"
import { retirement } from "../teamLifecycle"
import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server"

const pool = new Workpool(components.inboundPool, { maxParallelism: 4 })
async function enqueue(ctx: MutationCtx, id: Id<"inboundMessages">) {
  await pool.enqueueAction(
    ctx,
    internal.ses.inboundTransfer.transfer,
    { id },
    {
      retry: { maxAttempts: 12, initialBackoffMs: 1000, base: 2 },
      onComplete: internal.ses.inboundMessages.transferDone,
      context: { id },
    }
  )
}

/* The only module that writes `inboundMessages`. */

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const text = (value: unknown) =>
  typeof value === "string" && value.length <= 1024 ? value : undefined
/** The fields of SES's "Received" notification that route it, or null.
    https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html */
export function receivedMail(raw: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const notification = record(parsed)
  const mail = record(notification.mail)
  const receipt = record(notification.receipt)
  const action = record(receipt.action)
  const sesMessageId = text(mail.messageId)
  const bucket = text(action.bucketName)
  const objectKey = text(action.objectKey)
  const recipients = Array.isArray(receipt.recipients)
    ? receipt.recipients.slice(0, 50).flatMap((r) => text(r) ?? [])
    : []
  if (
    notification.notificationType !== "Received" ||
    action.type !== "S3" ||
    !sesMessageId ||
    !bucket ||
    !objectKey
  )
    return null
  return { sesMessageId, bucket, objectKey, recipients }
}
/** The distinct domains of the envelope recipients the rule matched. */
export const recipientDomains = (recipients: string[]) => [
  ...new Set(
    recipients.flatMap((address) => {
      const at = address.lastIndexOf("@")
      return at > 0 ? [address.slice(at + 1).toLowerCase()] : []
    })
  ),
]

/** Stores a verified inbound notification once, for the team whose domain
    received it. Returns whether it was stored. This is the receiving
    pipeline's entry point: processing starts from the row inserted here. */
export const ingest = internalMutation({
  args: { topicArn: v.string(), messageId: v.string(), message: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const inbound = await ctx.db
      .query("inboundRegions")
      .withIndex("by_topicArn", (q) => q.eq("topicArn", args.topicArn))
      .unique()
    if (!inbound) throw new Error("Unknown SNS topic")
    const existing = await ctx.db
      .query("inboundMessages")
      .withIndex("by_topicArn_and_messageId", (q) =>
        q.eq("topicArn", args.topicArn).eq("messageId", args.messageId)
      )
      .unique()
    if (existing) {
      if (await retirement(ctx, existing.organizationId)) return false
      if (
        existing.transferError &&
        !existing.rejected &&
        existing.deletedFromS3At === undefined
      ) {
        await ctx.db.patch("inboundMessages", existing._id, {
          transferError: undefined,
        })
        await enqueue(ctx, existing._id)
      }
      return false
    }
    const mail = receivedMail(args.message)
    // SES's setup test message and anything not stored in our bucket.
    if (!mail || mail.bucket !== inbound.bucket) return false
    const objectExists = await ctx.db
      .query("inboundMessages")
      .withIndex("by_bucket_and_objectKey", (q) =>
        q.eq("bucket", mail.bucket).eq("objectKey", mail.objectKey)
      )
      .first()
    if (objectExists) return false
    for (const name of recipientDomains(mail.recipients).slice(0, 10)) {
      const domain = await ctx.db
        .query("domains")
        .withIndex("by_name_and_region_and_deleted", (q) =>
          q.eq("name", name).eq("region", inbound.region).eq("deleted", false)
        )
        .unique()
      if (
        !domain?.receiving ||
        (await retirement(ctx, domain.organizationId)) ||
        mail.objectKey !== `${domain._id}/${mail.sesMessageId}`
      )
        continue
      const id = await ctx.db.insert("inboundMessages", {
        organizationId: domain.organizationId,
        domainId: domain._id,
        region: inbound.region,
        topicArn: args.topicArn,
        messageId: args.messageId,
        sesMessageId: mail.sesMessageId,
        bucket: mail.bucket,
        objectKey: mail.objectKey,
        notification: args.message,
      })
      await enqueue(ctx, id)
      return true
    }
    return false
  },
})

export const get = internalQuery({
  args: { id: v.id("inboundMessages") },
  returns: v.union(schema.doc("inboundMessages"), v.null()),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("inboundMessages", id)
    return row && !(await retirement(ctx, row.organizationId)) ? row : null
  },
})
export const stored = internalMutation({
  args: {
    id: v.id("inboundMessages"),
    storageId: v.id("_storage"),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { id, storageId, size }) => {
    const row = await ctx.db.get("inboundMessages", id)
    if (
      !row ||
      (await retirement(ctx, row.organizationId)) ||
      (row.parsedAt !== undefined && !row.storageId)
    ) {
      await ctx.storage.delete(storageId)
      return null
    }
    if (row.storageId && row.storageId !== storageId)
      await ctx.storage.delete(storageId)
    else
      await ctx.db.patch("inboundMessages", id, {
        storageId,
        size,
        storedAt: Date.now(),
        transferError: undefined,
      })
    if (row.parsedAt === undefined)
      await pool.enqueueAction(
        ctx,
        internal.receivedParse.parse,
        { id },
        {
          retry: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
        }
      )
    return null
  },
})
export const deleted = internalMutation({
  args: { id: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (!(await ctx.db.get("inboundMessages", id))) return null
    await ctx.db.patch("inboundMessages", id, {
      deletedFromS3At: Date.now(),
      transferError: undefined,
    })
    return null
  },
})
export const reject = internalMutation({
  args: { id: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (!(await ctx.db.get("inboundMessages", id))) return null
    await ctx.db.patch("inboundMessages", id, {
      rejected: true,
      transferError: "Inbound message exceeds 40 MiB",
    })
    return null
  },
})
export const transferDone = internalMutation({
  args: vOnCompleteArgs(v.object({ id: v.id("inboundMessages") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (
      result.kind !== "success" &&
      (await ctx.db.get("inboundMessages", context.id))
    )
      await ctx.db.patch("inboundMessages", context.id, {
        transferError:
          "Inbound transfer failed; retry before the S3 lifecycle expires the object",
      })
    return null
  },
})
export const retry = internalMutation({
  args: { id: v.id("inboundMessages") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("inboundMessages", id)
    if (
      row &&
      !row.rejected &&
      row.deletedFromS3At === undefined &&
      !(await retirement(ctx, row.organizationId))
    )
      await enqueue(ctx, id)
    return null
  },
})
