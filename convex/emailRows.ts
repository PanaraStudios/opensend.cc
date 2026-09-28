import { recordMetric } from "./metricRows"
import { insertRow, patchRow } from "./counts"
import type { WithoutSystemFields } from "convex/server"
import type { MutationCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/* Sending and SES event projection share these writes. Counted rows go
   through the aggregate helpers in the same transaction. */

type EmailStatus = Doc<"emails">["status"]

/** A new email with its content, recipients and first timeline entry. */
export async function insertEmail(
  ctx: MutationCtx,
  row: WithoutSystemFields<Doc<"emails">>,
  content: Omit<WithoutSystemFields<Doc<"emailContents">>, "emailId">,
  recipients: readonly string[]
) {
  const emailId = await insertRow(ctx, "emails", row)
  await ctx.db.insert("emailContents", { ...content, emailId })
  for (const address of new Set(recipients))
    await insertRow(ctx, "emailRecipients", {
      organizationId: row.organizationId,
      emailId,
      address,
    })
  await insertEmailEvent(ctx, emailId, row.status)
  return emailId
}

export const patchEmail = (
  ctx: MutationCtx,
  id: Id<"emails">,
  patch: Partial<WithoutSystemFields<Doc<"emails">>>
) => patchRow(ctx, "emails", id, patch)

export async function insertEmailEvent(
  ctx: MutationCtx,
  emailId: Id<"emails">,
  type: EmailStatus,
  at = Date.now(),
  detail: Partial<
    Pick<Doc<"emailEvents">, "sesEventId" | "recipients" | "details">
  > = {}
) {
  const id = await insertRow(ctx, "emailEvents", {
    emailId,
    type,
    at,
    ...detail,
  })
  const email = (await ctx.db.get("emails", emailId))!
  await recordMetric(ctx, email, type, at, detail.recipients)
  return id
}

/** Moves an email to `status` and adds it to the timeline. SES event
    processing records delivered, bounced… through this. */
export async function recordEmailStatus(
  ctx: MutationCtx,
  id: Id<"emails">,
  status: EmailStatus,
  patch: Partial<WithoutSystemFields<Doc<"emails">>> = {}
) {
  await patchEmail(ctx, id, { ...patch, status })
  await insertEmailEvent(ctx, id, status)
}

/** Drops an email's body and attachments, keeping its row and timeline. */
export async function deleteEmailContent(ctx: MutationCtx, id: Id<"emails">) {
  const content = await ctx.db
    .query("emailContents")
    .withIndex("by_emailId", (q) => q.eq("emailId", id))
    .unique()
  if (!content) return
  for (const attachment of content.attachments ?? [])
    await ctx.storage.delete(attachment.storageId)
  await ctx.db.delete("emailContents", content._id)
}
