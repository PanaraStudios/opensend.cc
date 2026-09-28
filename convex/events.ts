import { requireActiveTeam } from "./teamLifecycle"
import type { FunctionReference } from "convex/server"
import { internal } from "./_generated/api"
import type { MutationCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import type { WebhookEvent } from "../lib/dashboard/types"

type Consumer = FunctionReference<
  "mutation",
  "internal",
  { id: Id<"events"> },
  null
>
/* Each consumer is an internal mutation taking the event id; a feature
   subscribes by adding its handler here. They run in their own transactions,
   so one failing consumer never loses the event for the others. */
const CONSUMERS: Consumer[] = [
  internal.webhooks.deliverEvent,
  internal.automationRuntime.consume,
]

/** Record an event in the caller's transaction and hand it to every
    consumer. Scheduling is transactional: if the caller rolls back, no
    consumer ever sees the event. */
export async function emitEvent(
  ctx: MutationCtx,
  organizationId: string,
  type: WebhookEvent | (string & {}),
  data: Record<string, unknown>
) {
  await requireActiveTeam(ctx, organizationId)
  const id = await ctx.db.insert("events", { organizationId, type, data })
  for (const consumer of CONSUMERS)
    await ctx.scheduler.runAfter(0, consumer, { id })
  return id
}
