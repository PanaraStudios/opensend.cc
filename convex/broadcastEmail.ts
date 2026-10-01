import { ConvexError } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import { draft, type BroadcastInput } from "./broadcasts"
import { createEmail, validateSender, type ResolvedSender } from "./emails"
import { defaultFromAddress } from "../lib/dashboard/format"
import { findTopicChoice, listProperties } from "./audience"
import { effectiveTopicSubscription } from "../lib/dashboard/contacts"
import { suppressedAmong } from "./suppressions"
import { insertRow } from "./counts"
import { renderEmail } from "./email/render"
import { unsubscribeLinks, unsubscribeContext } from "./unsubscribe"

export async function validateEmailBroadcast(
  ctx: MutationCtx,
  organizationId: string,
  input: BroadcastInput,
  sending: boolean
) {
  if (input.whatsapp)
    throw new ConvexError("WhatsApp configuration requires channel=whatsapp")
  if (!sending) return
  if (!input.subject?.trim())
    throw new ConvexError("Add a subject line to continue")
  if (!input.html && !input.text)
    throw new ConvexError("Add content to continue")
  if (!input.from) throw new ConvexError("Invalid from address")
  await validateSender(ctx, organizationId, input.from)
}
export async function initializeEmailBroadcast(
  ctx: QueryCtx,
  organizationId: string,
  input: BroadcastInput
) {
  if (input.from) return input
  const domain = await ctx.db
    .query("domains")
    .withIndex("by_organizationId_and_deleted_and_status_and_name", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("deleted", false)
        .eq("status", "verified")
    )
    .first()
  return domain ? { ...input, from: defaultFromAddress(domain.name) } : input
}
export async function eligibleEmailRecipients(
  ctx: QueryCtx,
  row: Pick<Doc<"broadcasts">, "organizationId">,
  candidates: Doc<"contacts">[],
  topic: Doc<"topics"> | null,
  sending: boolean
) {
  const suppressed = sending
    ? new Set<string>()
    : await suppressedAmong(
        ctx,
        row.organizationId,
        candidates.flatMap((c) => (c.email ? [c.email] : []))
      )
  const contacts = []
  for (const contact of candidates) {
    if (!contact.email || contact.unsubscribed || suppressed.has(contact.email))
      continue
    if (
      topic &&
      effectiveTopicSubscription(
        (await findTopicChoice(ctx, contact._id, topic._id))?.subscription,
        topic
      ) !== "subscribed"
    )
      continue
    contacts.push(contact)
  }
  return contacts
}
export async function prepareEmailBroadcast(
  ctx: QueryCtx,
  row: Doc<"broadcasts">
) {
  const body = await draft(ctx, row._id)
  if (!body) throw new Error("Broadcast not found")
  return {
    channel: "email" as const,
    body,
    properties: await listProperties(ctx, row.organizationId),
    senders: new Map<string, ResolvedSender>(),
    linksContext: undefined as
      Awaited<ReturnType<typeof unsubscribeContext>> | undefined,
  }
}
export async function sendEmailRecipient(
  ctx: MutationCtx,
  row: Doc<"broadcasts">,
  contact: Doc<"contacts">,
  topic: Doc<"topics"> | null,
  prepared: Awaited<ReturnType<typeof prepareEmailBroadcast>>
) {
  const id = row._id
  const email = contact.email
  if (!email) return
  const previous = await ctx.db
    .query("broadcastRecipients")
    .withIndex("by_broadcastId_and_email", (q) =>
      q.eq("broadcastId", id).eq("email", email)
    )
    .unique()
  if (previous) return
  prepared.linksContext ??= await unsubscribeContext(ctx)
  const links = await unsubscribeLinks(
    ctx,
    {
      organizationId: row.organizationId,
      contactId: contact._id,
      topicId: row.topicId ?? undefined,
      broadcastId: id,
    },
    { ...prepared.linksContext, contact, topic }
  )
  const values: Record<string, string | undefined> = {
    FIRST_NAME: contact.firstName || undefined,
    LAST_NAME: contact.lastName || undefined,
    EMAIL: email,
    "contact.first_name": contact.firstName || undefined,
    "contact.last_name": contact.lastName || undefined,
    "contact.email": email,
    ...links.variables,
    RESEND_UNSUBSCRIBE_URL: links.pageUrl,
  }
  for (const property of prepared.properties) {
    const value = contact.properties[property.key] ?? property.fallbackValue
    values[property.key] = value
    values[`contact.${property.key}`] = value
    values[`contact.properties.${property.key}`] = value
  }
  const rendered = renderEmail(
    {
      subject: row.subject,
      html: prepared.body.html,
      text: prepared.body.text,
    },
    values
  )
  const emailId = await createEmail(
    ctx,
    {
      ...rendered,
      from: row.from,
      to: [email],
      cc: [],
      bcc: [],
      replyTo: row.replyToAddresses ?? (row.replyTo ? [row.replyTo] : []),
      headers: Object.entries(links.headers).map(([name, value]) => ({
        name,
        value,
      })),
      tags: [],
      attachments: [],
    },
    {
      organizationId: row.organizationId,
      source: "dashboard",
      broadcastId: id,
      senders: prepared.senders,
    }
  )
  await insertRow(ctx, "broadcastRecipients", {
    organizationId: row.organizationId,
    broadcastId: id,
    contactId: contact._id,
    email,
    emailId,
    settled: false,
    failed: false,
  })
}
