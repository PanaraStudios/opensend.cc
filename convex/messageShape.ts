import type { Doc } from "./_generated/dataModel"
import type { QueryCtx } from "./_generated/server"
import { parseMailbox } from "../lib/dashboard/email-send"

export const messageBase = (
  row: {
    _id: string
    _creationTime: number
    from: string
    to: string | string[]
  },
  channel: "email" | "whatsapp" | "messenger" | "instagram",
  direction: "inbound" | "outbound",
  status: string,
  preview: string,
  contactId: string | null
) => ({
  id: row._id,
  object: "message" as const,
  channel,
  direction,
  from: row.from,
  to: row.to,
  status,
  preview,
  created_at: new Date(row._creationTime).toISOString(),
  contact_id: contactId,
})

/** Email has multiple recipients. The primary recipient (or inbound sender)
 * identifies its CRM contact; no contact is created as a side effect of reading. */
export async function emailContact(
  ctx: QueryCtx,
  email: Doc<"emails" | "receivedEmails">
) {
  const address = parseMailbox(
    "sender" in email ? email.from : (email.to[0] ?? "")
  )?.address.toLowerCase()
  if (!address) return null
  return (
    (
      await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_email", (q) =>
          q.eq("organizationId", email.organizationId).eq("email", address)
        )
        .first()
    )?._id ?? null
  )
}

export async function emailMessageShape(
  ctx: QueryCtx,
  email: Doc<"emails" | "receivedEmails">
) {
  const inbound = "sender" in email
  const content = inbound
    ? await ctx.db
        .query("receivedContents")
        .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
        .unique()
    : await ctx.db
        .query("emailContents")
        .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
        .unique()
  return {
    ...messageBase(
      email,
      "email",
      inbound ? "inbound" : "outbound",
      inbound ? "received" : email.status,
      content?.text ?? content?.html ?? email.subject,
      await emailContact(ctx, email)
    ),
    subject: email.subject,
    html: content?.html ?? null,
    text: content?.text ?? null,
    reply_to: email.replyTo ?? [],
    tags: "tags" in email ? (email.tags ?? []) : [],
  }
}
