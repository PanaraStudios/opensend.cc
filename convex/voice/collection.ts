import { internal } from "../_generated/api"
import { internalMutation } from "../_generated/server"
import { v } from "convex/values"
import { collectedValue } from "../tables/botToolkit"
import type { MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { validateFieldValue, type CollectedValue } from "../../lib/bot-toolkit"
import { resolveOrCreateCallPerson } from "../channels/identity"
import { updateContact } from "../audience"
import { emitEvent } from "../events"
export async function saveCollectedField(
  ctx: MutationCtx,
  call: Doc<"calls">,
  key: string,
  input: unknown,
  inferred = false
) {
  const field = call.botConfig?.collect?.find((f) => f.key === key)
  if (!field) throw new Error("This field is not configured for this bot")
  const value: CollectedValue = validateFieldValue(field, input)
  const property = field.contactProperty
    ? await ctx.db
        .query("contactProperties")
        .withIndex("by_organizationId_and_key", (q) =>
          q
            .eq("organizationId", call.organizationId)
            .eq("key", field.contactProperty!)
        )
        .unique()
    : null
  if (
    field.contactProperty &&
    (!property ||
      property.deleting ||
      (property.type === "number" && field.type !== "number"))
  )
    throw new Error(
      "The mapped contact property is no longer available or compatible"
    )
  const person = await resolveOrCreateCallPerson(ctx, call)
  if (property && person.contact)
    await updateContact(ctx, person.contact, {
      properties: { [property.key]: String(value) },
    })
  await ctx.db.patch("calls", call._id, {
    collected: { ...call.collected, [key]: { value, inferred } },
    ...(person.contact ? { contactId: person.contact._id } : {}),
    ...(person.identity ? { channelContactId: person.identity._id } : {}),
    ...(person.conversationId ? { conversationId: person.conversationId } : {}),
  })
  return { key, value, inferred }
}
export async function completeCollection(ctx: MutationCtx, call: Doc<"calls">) {
  if (call.dataCollectedAt || !call.botConfig?.collect?.length) return
  await ctx.db.patch("calls", call._id, {
    collected: call.collected ?? {},
    dataCollectedAt: Date.now(),
  })
  if (!call.test)
    await emitEvent(ctx, call.organizationId, "call.data_collected", {
      call_id: call._id,
      contact_id: call.contactId ?? null,
      collected: call.collected ?? {},
      missing: call.botConfig.collect
        .filter(
          (f) => f.required && !Object.hasOwn(call.collected ?? {}, f.key)
        )
        .map((f) => f.key),
    })
}

export async function inferCollectedFields(
  ctx: MutationCtx,
  initial: Doc<"calls">,
  input: unknown
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !initial.botConfig?.collect?.length
  )
    return
  const lines = await ctx.db
    .query("callTranscripts")
    .withIndex("by_callId", (q) => q.eq("callId", initial._id))
    .take(2000)
  for (const field of initial.botConfig.collect) {
    const call = (await ctx.db.get("calls", initial._id))!
    if (Object.hasOwn(call.collected ?? {}, field.key)) continue
    const candidate = (input as Record<string, unknown>)[field.key]
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      continue
    const { value, confidence, evidence } = candidate as Record<string, unknown>
    if (
      typeof confidence !== "number" ||
      confidence < 0.95 ||
      confidence > 1 ||
      typeof evidence !== "string" ||
      evidence.length < 2 ||
      evidence.length > 4096 ||
      !lines.some(
        (line) =>
          line.role === "caller" && line.final && line.text?.includes(evidence)
      )
    )
      continue
    try {
      validateFieldValue(field, value)
    } catch {
      continue
    }
    // Each field is its own subtransaction: an obsolete mapping cannot partially create a contact.
    await ctx
      .runMutation(internal.voice.collection.saveInferred, {
        callId: call._id,
        key: field.key,
        value: value as CollectedValue,
      })
      .catch(() => null)
  }
}

export const saveInferred = internalMutation({
  args: { callId: v.id("calls"), key: v.string(), value: collectedValue },
  returns: v.any(),
  handler: async (ctx, args) => {
    const call = await ctx.db.get("calls", args.callId)
    if (!call || Object.hasOwn(call.collected ?? {}, args.key)) return null
    return saveCollectedField(ctx, call, args.key, args.value, true)
  },
})
