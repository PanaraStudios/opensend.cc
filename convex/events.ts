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
  const id = await ctx.db.insert("events", { organizationId, type, data })
  const consumer =
    customEventName(type) === null
      ? internal.webhooks.deliverEvent
      : internal.automationRuntime.consume
  await ctx.scheduler.runAfter(0, consumer, { id })
  if (type === "contact.note_created" || type.startsWith("call."))
    await ctx.scheduler.runAfter(0, internal.webhooks.deliverEvent, { id })
  return id
}
