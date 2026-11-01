import type { TestConvex } from "convex-test"
import type schema from "../schema"
import { insertRow } from "../counts"
import { WEBHOOK_EVENTS } from "../../lib/dashboard/types"

/** Subscribes an enabled webhook of the team to `events` (every webhook
    event by default), so the outbox stores and delivers them: events nobody
    listens to are not stored. */
export async function listenToEvents(
  t: TestConvex<typeof schema>,
  organizationId: string,
  events: readonly string[] = WEBHOOK_EVENTS
) {
  return t.run(async (ctx) => {
    const webhookId = await insertRow(ctx, "webhooks", {
      organizationId,
      endpoint: "https://listener.example.test/hook",
      events: [...events],
      enabled: true,
      secret: "unused",
    })
    for (const event of events)
      await ctx.db.insert("webhookSubscriptions", {
        organizationId,
        event,
        enabled: true,
        webhookId,
      })
    return webhookId
  })
}
