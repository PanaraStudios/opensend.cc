import type { Doc, Id, TableNames } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import schema from "./schema"

// These optional storage fields must not change dashboard or public API shapes.
export const publicRecipientValue = schema
  .doc("broadcastRecipients")
  .omit("displayIdentity", "displayMessageStatus")

export function publicRecipient(recipient: Doc<"broadcastRecipients">) {
  const { displayIdentity, displayMessageStatus, ...row } = recipient
  void displayIdentity
  void displayMessageStatus
  return row
}

/** A page may repeat foreign keys (including legacy recipient rows). */
export async function readPageDocuments<T extends TableNames>(
  ctx: QueryCtx,
  table: T,
  ids: Id<T>[]
) {
  return new Map(
    await Promise.all(
      [...new Set(ids)].map(
        async (id) => [id, await ctx.db.get(table, id)] as const
      )
    )
  )
}

/** New rows carry just the live status; legacy rows read each message once.
 * Null is a known missing message, distinct from an unpopulated legacy field. */
export function recipientMessageStatuses(
  ctx: QueryCtx,
  organizationId: string
) {
  const messages = new Map<
    Id<"channelMessages">,
    Promise<Doc<"channelMessages"> | null>
  >()
  return async (recipient: Doc<"broadcastRecipients">) => {
    if (!recipient.messageId) return undefined
    if (recipient.displayMessageStatus !== undefined)
      return recipient.displayMessageStatus ?? undefined
    let message = messages.get(recipient.messageId)
    if (!message) {
      message = ctx.db.get("channelMessages", recipient.messageId)
      messages.set(recipient.messageId, message)
    }
    const row = await message
    return row?.organizationId === organizationId ? row.status : undefined
  }
}
