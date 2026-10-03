import { contactEventData, eventSegmentIds } from "./audience"
import { SYSTEM_EVENT_CATALOG } from "../lib/event-catalog"
import { parseMailbox } from "../lib/dashboard/email-send"
import { requireActiveTeam } from "./teamLifecycle"
import { customEventName } from "./automationEvents"
import { internal } from "./_generated/api"
import type { MutationCtx } from "./_generated/server"
import type { WebhookEvent } from "../lib/dashboard/types"

/** Record and schedule the matching consumer in the caller's transaction. */
export async function emitEvent(
  ctx: MutationCtx,
  organizationId: string,
  type: WebhookEvent | (string & {}),
  data: Record<string, unknown>
) {
  await requireActiveTeam(ctx, organizationId)
  const originalData = data
  if (SYSTEM_EVENT_CATALOG.some((event) => event.name === type)) {
    let contactId =
      typeof data.contact_id === "string"
        ? ctx.db.normalizeId("contacts", data.contact_id)
        : null
    if (!contactId && type.startsWith("contact."))
      contactId = ctx.db.normalizeId("contacts", String(data.id))
    if (!contactId && typeof data.conversation_id === "string") {
      const conversationId = ctx.db.normalizeId(
        "conversations",
        data.conversation_id
      )
      const conversation = conversationId
        ? await ctx.db.get("conversations", conversationId)
        : null
      if (
        conversation?.organizationId === organizationId &&
        conversation.channelContactId
      ) {
        const identity = await ctx.db.get(
          "channelContacts",
          conversation.channelContactId
        )
        contactId = identity?.contactId ?? null
      }
    }
    if (
      !contactId &&
      type.startsWith("whatsapp.call.") &&
      typeof data.id === "string"
    ) {
      const callId = ctx.db.normalizeId("calls", data.id)
      const call = callId ? await ctx.db.get("calls", callId) : null
      if (call?.organizationId === organizationId)
        contactId = call.contactId ?? null
    }
    let contact = contactId ? await ctx.db.get("contacts", contactId) : null
    const address =
      type === "email.received"
        ? data.from
        : Array.isArray(data.to)
          ? data.to[0]
          : data.email
    if (!contact && typeof address === "string") {
      const email =
        parseMailbox(address)?.address ?? address.trim().toLowerCase()
      contact = await ctx.db
        .query("contacts")
        .withIndex("by_organizationId_and_email", (q) =>
          q.eq("organizationId", organizationId).eq("email", email)
        )
        .unique()
    }
    if (contact && contact.organizationId !== organizationId) contact = null
    if (contact?.organizationId === organizationId)
      data = {
        ...data,
        contact: contactEventData(
          contact,
          await eventSegmentIds(ctx, contact._id)
        ),
        contact_id: contact._id,
      }
    if (
      ["contact.created", "contact.updated", "contact.deleted"].includes(type)
    )
      data = { ...data, contact: originalData }
    if (type.includes(".message.") || type.startsWith("email."))
      data = { ...data, message: { ...originalData } }
  }
  const id = await ctx.db.insert("events", { organizationId, type, data })
  if (customEventName(type) === null)
    await ctx.scheduler.runAfter(0, internal.webhooks.deliverEvent, { id })
  if (
    customEventName(type) !== null ||
    SYSTEM_EVENT_CATALOG.some((event) => event.name === type)
  )
    await ctx.scheduler.runAfter(0, internal.automationRuntime.consume, { id })
  return id
}
