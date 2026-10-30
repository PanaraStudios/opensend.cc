"use node"
import { mediaLinks } from "../storage/objects"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { graph } from "../meta/graph"
import { isUnreachableError } from "../../lib/net/public-fetch"
import { MetaError } from "../../lib/meta/errors"
import { isMediaIdGone } from "../../lib/meta/media"
import type { MediaCacheUse } from "./mediaUpload"
import { object, array, string } from "../../lib/meta/webhooks"

export const deliver = internalAction({
  args: { id: v.id("channelMessages"), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const claim = await ctx.runMutation(internal.channels.messages.claim, args)
    if (!claim) return null
    let outcome:
      | {
          kind: "sent"
          externalId: string
          response?: string
          mediaIds?: string[]
        }
      | {
          kind: "failed"
          error: string
          code?: number
          title?: string
          action: "retry" | "retry_after" | "final" | "token_invalid"
        }
    const payload: unknown = JSON.parse(claim.payload)
    const cache: MediaCacheUse = { mediaIds: [], reused: [] }
    const send = async () =>
      object(
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
                  payload,
                  claim.organizationId,
                  claim.accountId,
                  cache
                )
              ),
              ...(claim.messagingType
                ? { messaging_type: claim.messagingType }
                : {}),
            },
          },
        })
      )
    try {
      let result: Record<string, unknown>
      try {
        result = await send()
      } catch (error) {
        // Meta refused a reused upload it no longer knows: nothing was
        // sent, so upload the files again and send once more.
        if (
          !(error instanceof MetaError) ||
          !cache.reused.length ||
          !isMediaIdGone(error)
        )
          throw error
        await ctx.runMutation(internal.channels.mediaCache.forget, {
          entries: cache.reused,
        })
        cache.fresh = true
        cache.mediaIds = []
        result = await send()
      }
      const externalId =
        string(result.message_id) ||
        string(object(array(result.messages)[0]).id)
      // A malformed success is ambiguous; do not resend.
      if (!externalId)
        throw new Error("Meta accepted the call without a message id")
      outcome = {
        kind: "sent",
        externalId,
        response: JSON.stringify(result),
        ...(cache.mediaIds.length ? { mediaIds: cache.mediaIds } : {}),
      }
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
