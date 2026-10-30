import { contactEventData, eventSegmentIds } from "./audience"
import { SYSTEM_EVENT_CATALOG } from "../lib/event-catalog"
import { parseMailbox } from "../lib/dashboard/email-send"
import { requireActiveTeam } from "./teamLifecycle"
import { customEventName } from "./automationEvents"
import { internal } from "./_generated/api"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import type { WebhookEvent } from "../lib/dashboard/types"

type EventData = Record<string, unknown>

/** Record and schedule the matching consumers in the caller's transaction,
    when something can use the event: an enabled webhook subscribed to its
    type, an enabled automation on its trigger, or a run waiting for it.
    Custom events are always recorded. Otherwise nothing is stored and null
    comes back. */
export function emitEvent(
  ctx: MutationCtx,
  organizationId: string,
  type: WebhookEvent | (string & {}),
  data: EventData
) {
  const read = async () => data
  return publish(ctx, organizationId, type, read, read, false)
}

/** `emitEvent` for a payload that costs reads to build (a hydrated channel
    message). `probe` returns the fields the event's contact is found by
    (`contact_id`, `conversation_id`, ...), so a run waiting for the event can
    be found; `data` is built only when something listens. */
export function emitLazyEvent(
  ctx: MutationCtx,
  organizationId: string,
  type: WebhookEvent | (string & {}),
  probe: () => Promise<EventData>,
  data: () => Promise<EventData>
) {
  return publish(ctx, organizationId, type, probe, data, false)
}

/** `emitEvent` that stores and schedules even with no listener, for tests
    that drive the consumers by hand. */
export async function emitEventAlways(
  ctx: MutationCtx,
  organizationId: string,
  type: WebhookEvent | (string & {}),
  data: EventData
) {
  const read = async () => data
  return (await publish(ctx, organizationId, type, read, read, true))!
}

async function publish(
  ctx: MutationCtx,
  organizationId: string,
  type: string,
  probe: () => Promise<EventData>,
  build: () => Promise<EventData>,
  always: boolean
): Promise<Id<"events"> | null> {
  await requireActiveTeam(ctx, organizationId)
  const custom = customEventName(type) !== null
  const system = SYSTEM_EVENT_CATALOG.find((event) => event.name === type)
  // The row and its consumers (webhook delivery, then the automation
  // dispatcher's consume, wait and start phases) exist for listeners. Each
  // check is one indexed `.first()`; all of them run in this transaction,
  // so a webhook or automation committed before the event is always seen.
  const webhook =
    !custom && (always || (await webhookListens(ctx, organizationId, type)))
  let automation =
    custom ||
    (system !== undefined &&
      (always ||
        (await automationEnabled(ctx, organizationId, system.trigger))))
  if (!webhook && !automation && system !== undefined)
    automation = await runWaits(
      ctx,
      organizationId,
      type,
      system.trigger,
      await probe()
    )
  if (!webhook && !automation) return null
  const data = await enrich(ctx, organizationId, type, await build())
  const id = await ctx.db.insert("events", { organizationId, type, data })
  if (webhook)
    await ctx.scheduler.runAfter(0, internal.webhooks.deliverEvent, { id })
  if (automation)
    await ctx.scheduler.runAfter(0, internal.automationRuntime.consume, { id })
  return id
}

/** The team's contact a system event is about, from its ids, conversation,
    call or address. */
async function resolveContact(
  ctx: QueryCtx,
  organizationId: string,
  type: string,
  data: EventData
) {
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
    const email = parseMailbox(address)?.address ?? address.trim().toLowerCase()
    contact = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_email", (q) =>
        q.eq("organizationId", organizationId).eq("email", email)
      )
      .unique()
  }
  return contact?.organizationId === organizationId ? contact : null
}

/** The stored payload: system events carry their contact. */
async function enrich(
  ctx: QueryCtx,
  organizationId: string,
  type: string,
  data: EventData
) {
  if (!SYSTEM_EVENT_CATALOG.some((event) => event.name === type)) return data
  const originalData = data
  const contact = await resolveContact(ctx, organizationId, type, data)
  if (contact)
    data = {
      ...data,
      contact: contactEventData(
        contact,
        await eventSegmentIds(ctx, contact._id)
      ),
      contact_id: contact._id,
    }
  if (["contact.created", "contact.updated", "contact.deleted"].includes(type))
    data = { ...data, contact: originalData }
  if (type.includes(".message.") || type.startsWith("email."))
    data = { ...data, message: { ...originalData } }
  return data
}

/** The contact `automationRuntime.dispatch` matches an event to, from the
    data as stored; null when the data names another team's contact. */
export async function dispatchContact(
  ctx: QueryCtx,
  organizationId: string,
  type: string,
  data: EventData
): Promise<{
  contactId: Id<"contacts"> | null
  contact: Doc<"contacts"> | null
} | null> {
  const contactId =
    typeof data.contact_id === "string"
      ? ctx.db.normalizeId("contacts", data.contact_id)
      : type.startsWith("contact.") && typeof data.id === "string"
        ? ctx.db.normalizeId("contacts", data.id)
        : null
  let contact = contactId ? await ctx.db.get("contacts", contactId) : null
  if (contact && contact.organizationId !== organizationId) return null
  if (!contactId && !contact && typeof data.email === "string")
    contact = await ctx.db
      .query("contacts")
      .withIndex("by_organizationId_and_email", (q) =>
        q.eq("organizationId", organizationId).eq("email", data.email as string)
      )
      .unique()
  return { contactId, contact }
}

async function webhookListens(
  ctx: QueryCtx,
  organizationId: string,
  type: string
) {
  return (
    (await ctx.db
      .query("webhookSubscriptions")
      .withIndex("by_organizationId_and_event_and_enabled", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("event", type)
          .eq("enabled", true)
      )
      .first()) !== null
  )
}

async function automationEnabled(
  ctx: QueryCtx,
  organizationId: string,
  trigger: string
) {
  return (
    (await ctx.db
      .query("automations")
      .withIndex("by_organizationId_and_trigger_and_status", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("trigger", trigger)
          .eq("status", "enabled")
      )
      .first()) !== null
  )
}

/** Whether a run waits for this event, matched to the contact the
    dispatcher's wait phase would use for the stored event. */
async function runWaits(
  ctx: QueryCtx,
  organizationId: string,
  type: string,
  trigger: string,
  probe: EventData
) {
  // The stored event names this contact; the dispatcher reads it back.
  const contact = await resolveContact(ctx, organizationId, type, probe)
  const target = contact
    ? { contact }
    : await dispatchContact(ctx, organizationId, type, probe)
  if (!target) return false
  return (
    (await ctx.db
      .query("automationRuns")
      .withIndex("by_organizationId_and_contactId_and_waitingName", (q) =>
        q
          .eq("organizationId", organizationId)
          .eq("contactId", target.contact?._id)
          .eq("waitingName", trigger)
      )
      .first()) !== null
  )
}
