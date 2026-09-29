import type { HttpRouter } from "convex/server"
import { v } from "convex/values"
import { env, internalMutation } from "../_generated/server"
import { internal } from "../_generated/api"
import { createShare, shareDuration, shareUrl } from "../emailShares"
import { randomToken } from "../../lib/oauth/policy"
import { callerValue, requireCaller } from "./caller"
import { idempotent } from "./idempotency"
import { apiRoute, objectBody } from "./route"

// Idempotency stores only a random nonce. Recover the same bearer using a
// domain-separated PRF, so neither the share table nor the replay cache has it.
async function replayToken(nonce: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`opensend:email-share:${nonce}`)
  )
  return Array.from(new Uint8Array(signature), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")
}

export const create = internalMutation({
  args: { caller: callerValue, id: v.string(), body: v.string() },
  returns: v.object({
    object: v.literal("email"),
    id: v.string(),
    nonce: v.string(),
    origin: v.string(),
  }),
  handler: async (ctx, { caller, id, body }) => {
    await requireCaller(ctx, caller)
    return idempotent(
      ctx,
      caller,
      async () => {
        const duration = shareDuration(objectBody(JSON.parse(body)).expires_in)
        const nonce = randomToken()
        const share = await createShare(
          ctx,
          caller.organizationId,
          id,
          duration,
          await replayToken(nonce)
        )
        return {
          object: share.object,
          id: share.id,
          nonce,
          origin: shareUrl(""),
        }
      },
      (body) => ({ body })
    )
  },
})

export function registerEmailShareRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/emails/{email_id}/share",
    permission: "full_access",
    handler: async (ctx, { caller, params, body }) => ({
      body: await ctx.runMutation(internal.api.emailShares.create, {
        caller,
        id: params.email_id,
        body: JSON.stringify(body === undefined ? {} : body),
      }),
    }),
    serializeResponse: async (body) => {
      const { object, id, nonce, origin } = body as {
        object: string
        id: string
        nonce: string
        origin: string
      }
      return { object, id, url: origin + (await replayToken(nonce)) }
    },
  })
}
