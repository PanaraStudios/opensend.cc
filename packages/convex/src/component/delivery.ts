import { Opensend, type ErrorResponse } from "@opensendcc/sdk/convex"
import { v } from "convex/values"
import { internal } from "./_generated/api.js"
import { internalAction } from "./_generated/server.js"
import { vDeliverResult } from "./shared.js"

/* One attempt. Throwing tells the workpool to retry, so only throw for
   failures a later attempt can fix. */
export const deliver = internalAction({
  args: { emailId: v.id("emails"), apiKey: v.string(), baseUrl: v.string() },
  returns: vDeliverResult,
  handler: async (ctx, { emailId, apiKey, baseUrl }) => {
    const queued = await ctx.runQuery(internal.lib.getQueued, { emailId })
    if (!queued) return { sent: false as const, error: "No longer queued." }

    const { email, idempotencyKey } = queued
    const { html, text, template, ...metadata } = email
    const body = template
      ? { template }
      : html !== undefined
        ? { html, text, from: email.from!, subject: email.subject! }
        : { text: text!, from: email.from!, subject: email.subject! }
    const { data, error } = await new Opensend(apiKey, { baseUrl }).emails.send(
      {
        ...metadata,
        ...body,
        tags: [
          ...(email.tags ?? []),
          { name: "opensend_component_email", value: emailId },
        ],
      },
      { idempotencyKey }
    )
    if (data) {
      // Persist acceptance before the workpool's asynchronous completion callback.
      await ctx.runMutation(internal.lib.recordAcceptance, {
        emailId,
        opensendId: data.id,
      })
      return { sent: true as const, opensendId: data.id }
    }

    const reason = describeError(error)
    if (isRetryable(error)) throw new Error(reason)
    return { sent: false as const, error: reason }
  },
})

/* Worth another attempt: no response, rate limited, the same key still in
   flight, or a server error. Other 4xx answers, such as a bad key or an
   unverified sender, fail the same way every time. */
function isRetryable(error: ErrorResponse): boolean {
  if (error.statusCode === null) return true
  return (
    error.statusCode === 429 ||
    error.statusCode >= 500 ||
    error.name === "concurrent_idempotent_requests"
  )
}

function describeError(error: ErrorResponse): string {
  return `OpenSend ${error.statusCode ?? "no response"} ${error.name}: ${error.message}`
}
