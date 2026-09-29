"use node"
import { v } from "convex/values"
import { internalAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { limitedBody } from "./ses/web"
import { publicFetch } from "../lib/net/public-fetch"
import { webhookEndpointError } from "../lib/dashboard/webhooks"
import { webhookHeaders } from "../lib/webhooks/signing"

/** Svix waits 15 seconds for an answer. */
const TIMEOUT = 15_000
const RESPONSE_LIMIT = 4096

function failure(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return `No response within ${TIMEOUT / 1000} seconds`
    const cause = (error as { cause?: { code?: unknown } }).cause
    return typeof cause?.code === "string"
      ? `${error.message} (${cause.code})`
      : error.message
  }
  return "The request failed"
}

async function post(target: {
  endpoint: string
  messageId: string
  payload: Record<string, unknown>
  secret: string
  previousSecret?: string
}) {
  const problem = webhookEndpointError(target.endpoint)
  if (problem) throw new Error(problem)
  const url = new URL(target.endpoint)
  const body = JSON.stringify(target.payload)
  const response = await publicFetch(url, {
    method: "POST",
    headers: await webhookHeaders({
      id: target.messageId,
      timestamp: Math.floor(Date.now() / 1000),
      body,
      secret: target.secret,
      previousSecret: target.previousSecret,
    }),
    body,
    // Svix counts a redirect as a failure; following one could also lead
    // to a host that was never checked.
    timeoutMs: TIMEOUT,
    maxBytes: RESPONSE_LIMIT,
    truncate: true,
  })
  return {
    status: response.status,
    response: await limitedBody(response, RESPONSE_LIMIT, { truncate: true }),
  }
}

/** One attempt at one delivery. A newer attempt number than the delivery
    has already recorded is never sent twice. */
export const attempt = internalAction({
  args: { id: v.id("webhookDeliveries"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const target = await ctx.runMutation(internal.webhooks.claimAttempt, args)
    if (!target) return null
    const started = Date.now()
    const result = await post(target).catch((error: unknown) => ({
      status: 0,
      response: failure(error),
    }))
    await ctx.runMutation(internal.webhooks.recordAttempt, {
      ...args,
      ...result,
      durationMs: Date.now() - started,
    })
    return null
  },
})
