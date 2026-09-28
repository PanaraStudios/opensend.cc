import type { Infer } from "convex/values"
import type { Doc } from "./_generated/dataModel"
import type { MutationCtx } from "./_generated/server"
import { insertRow, patchRow } from "./counts"
import { metricType } from "./tables/metrics"
import { parseMailbox, addressKey } from "../lib/dashboard/email-send"

export function emailAddresses(email: Doc<"emails">) {
  return [
    ...new Set(
      [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])]
        .map((address) => parseMailbox(address))
        .filter((address) => address !== null)
        .map(addressKey)
    ),
  ].filter((address) => !email.suppressed?.includes(address))
}

export async function recordMetric(
  ctx: MutationCtx,
  email: Doc<"emails">,
  type: Infer<typeof metricType>,
  at: number,
  recipients = emailAddresses(email)
) {
  if (email.source === "system") return
  const domain = await ctx.db.get("domains", email.domainId)
  if (
    domain?.tenantId &&
    (type === "sent" || type === "Permanent" || type === "complained")
  ) {
    for (const address of recipients) {
      const previous = await ctx.db
        .query("recipientMetrics")
        .withIndex("by_emailId_and_type_and_address", (q) =>
          q.eq("emailId", email._id).eq("type", type).eq("address", address)
        )
        .unique()
      if (!previous)
        await insertRow(ctx, "recipientMetrics", {
          organizationId: email.organizationId,
          emailId: email._id,
          tenantId: domain.tenantId,
          type,
          address,
          at,
        })
      else if (at < previous.at)
        await patchRow(ctx, "recipientMetrics", previous._id, { at })
    }
  }
  const existing = await ctx.db
    .query("emailMetrics")
    .withIndex("by_emailId_and_type", (q) =>
      q.eq("emailId", email._id).eq("type", type)
    )
    .unique()
  if (existing) {
    const addresses = [...new Set([...existing.recipients, ...recipients])]
    if (addresses.length !== existing.recipients.length || at < existing.at)
      await patchRow(ctx, "emailMetrics", existing._id, {
        recipients: addresses,
        at: Math.min(at, existing.at),
      })
    return
  }
  await insertRow(ctx, "emailMetrics", {
    emailId: email._id,
    organizationId: email.organizationId,
    domainId: email.domainId,
    tenantId: domain?.tenantId,
    type,
    createdAt: email._creationTime,
    at,
    recipients,
  })
}
