import { v } from "convex/values"
import { internalMutation } from "../_generated/server"

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
    if (existing) return false
    const mail = receivedMail(args.message)
    // SES's setup test message and anything not stored in our bucket.
    if (!mail || mail.bucket !== inbound.bucket) return false
    for (const name of recipientDomains(mail.recipients).slice(0, 10)) {
      const domain = await ctx.db
        .query("domains")
        .withIndex("by_name_and_region_and_deleted", (q) =>
          q.eq("name", name).eq("region", inbound.region).eq("deleted", false)
        )
        .unique()
      if (!domain?.receiving) continue
      await ctx.db.insert("inboundMessages", {
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
      // Receiving (parse the S3 object, `email.received`) starts here.
      return true
    }
    return false
  },
})
