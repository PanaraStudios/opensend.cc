"use node"
import { v } from "convex/values"
import { internalAction } from "../_generated/server"
import { internal } from "../_generated/api"
import { decryptSecret } from "../secrets"
import { graph, graphFailure, markTokenInvalid } from "../meta/graph"
import { MetaError } from "../../lib/meta/errors"
import { channelStrategies } from "../../lib/meta/payloads"
import { controlJob } from "../tables/channels"

export const send = internalAction({
  args: controlJob.fields,
  returns: v.object({ error: v.union(v.null(), v.string()) }),
  handler: async (
    ctx,
    { messageId, read, typing }
  ): Promise<{ error: string | null }> => {
    let connectionId
    let receiptRecorded = false
    try {
      const credentials = await ctx.runQuery(
        internal.channels.controls.credentials,
        { messageId, read }
      )
      connectionId = credentials.connectionId
      const strategy = channelStrategies[credentials.channel]
      const token = await decryptSecret(credentials.encryptedToken)
      const typingBody =
        typing === undefined
          ? null
          : strategy.typing(
              credentials.recipient,
              typing,
              credentials.externalId
            )
      const receiptBody = read
        ? strategy.readReceipt(credentials.externalId, credentials.recipient)
        : null
      const bodies =
        credentials.channel === "whatsapp" && typingBody
          ? [typingBody]
          : [receiptBody, typingBody].filter((body) => body !== null)
      for (const body of bodies) {
        await graph({
          token,
          version: credentials.version,
          method: "POST",
          path: `${credentials.endpoint}/messages`,
          body: { json: body },
        })
        // WhatsApp typing also marks the source message as read.
        if (
          !receiptRecorded &&
          (body === receiptBody || credentials.channel === "whatsapp")
        ) {
          await ctx.runMutation(internal.channels.controls.record, {
            messageId,
            read: true,
          })
          receiptRecorded = true
        }
      }
      return { error: null }
    } catch (error) {
      if (
        error instanceof MetaError &&
        error.action === "token_invalid" &&
        connectionId
      )
        await markTokenInvalid(ctx, connectionId)
      const reason = graphFailure(error)
      await ctx.runMutation(internal.channels.controls.record, {
        messageId,
        read: read && !receiptRecorded,
        error: reason,
      })
      return { error: reason }
    }
  },
})
