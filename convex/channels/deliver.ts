"use node"
import { mediaLinks } from "../storage/objects"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { graph } from "../meta/graph"
import { isUnreachableError } from "../../lib/net/public-fetch"
import { MetaError } from "../../lib/meta/errors"
import { object, array, string } from "../../lib/meta/webhooks"

export const deliver = internalAction({
  args: { id: v.id("channelMessages"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(internal.channels.messages.claim, args)
    if (!claim) return null
    let outcome:
      | { kind: "sent"; externalId: string }
      | {
          kind: "failed"
          error: string
          code?: number
          title?: string
          action: "retry" | "retry_after" | "final" | "token_invalid"
        }
    try {
      const result = object(
        await graph({
          token: claim.token,
          version: claim.version,
          method: "POST",
          path: `${claim.phoneNumberId}/messages`,
          body: {
            json: {
              ...object(
                await mediaLinks(
                  ctx,
                  JSON.parse(claim.payload),
                  claim.organizationId
                )
              ),
              ...(claim.messagingType
                ? { messaging_type: claim.messagingType }
                : {}),
            },
          },
        })
      )
      const externalId =
        string(result.message_id) ||
        string(object(array(result.messages)[0]).id)
      // A malformed success is ambiguous; do not resend.
      if (!externalId)
        throw new Error("Meta accepted the call without a message id")
      outcome = { kind: "sent", externalId }
    } catch (error) {
      if (isUnreachableError(error)) {
        outcome = {
          kind: "failed",
          error: (error as Error).message,
          action: "retry",
        }
      } else {
        if (!(error instanceof MetaError)) throw error
        outcome = {
          kind: "failed",
          error: error.message,
          action: error.action,
          ...(error.code !== undefined ? { code: error.code } : {}),
          ...(error.title ? { title: error.title } : {}),
        }
      }
    }
    // A failed record also goes to onComplete, never back through Graph.
    await ctx.runMutation(internal.channels.messages.record, {
      ...args,
      outcome,
    })
    return null
  },
})
