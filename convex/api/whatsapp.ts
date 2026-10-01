import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { internalMutation, internalQuery } from "../_generated/server"
import { internal } from "../_generated/api"
import {
  createChannelMessage,
  channelInputValue,
  resolveWhatsAppAccount,
} from "../channels/messages"
import {
  callerValue,
  requireCaller,
  apiError,
  invalid,
  type Caller,
} from "./caller"
import { idempotent } from "./idempotency"
import { objectBody, stringField, arrayField, enumField } from "./route"
import { channelMessageRoutes } from "./channelMessages"
import { findMetaApp } from "../meta/app"
import {
  MAX_WHATSAPP_MEDIA_BYTES,
  validateWhatsAppMedia,
} from "../../lib/meta/media"
import { WHATSAPP_SEND_TYPES } from "../../lib/meta/payloads"

export function assertChannelSendingKey(caller: Caller) {
  if (caller.domainId)
    throw apiError(
      403,
      "restricted_api_key",
      "Domain-restricted API keys can only send email."
    )
}
export const send = internalMutation({
  args: { caller: callerValue, input: channelInputValue },
  returns: v.id("channelMessages"),
  handler: async (ctx, { caller, input }) => {
    await requireCaller(ctx, caller, "sending")
    assertChannelSendingKey(caller)
    return idempotent(
      ctx,
      caller,
      () =>
        createChannelMessage(ctx, input, {
          organizationId: caller.organizationId,
          source: "api",
          apiKeyId: caller.apiKeyId,
        }),
      (id) => ({ body: { id } })
    )
  },
})
export const uploadTarget = internalQuery({
  args: { caller: callerValue, from: v.optional(v.string()) },
  returns: v.object({
    accountId: v.id("channelAccounts"),
    phoneNumberId: v.string(),
    encryptedToken: v.string(),
    version: v.string(),
  }),
  handler: async (ctx, { caller, from }) => {
    await requireCaller(ctx, caller, "sending")
    assertChannelSendingKey(caller)
    const account = await resolveWhatsAppAccount(
      ctx,
      caller.organizationId,
      from
    )
    const connection = (await ctx.db.get(
      "metaConnections",
      account.connectionId
    ))!
    const app = await findMetaApp(ctx)
    if (!app) throw invalid("Meta app is not configured.")
    return {
      accountId: account._id,
      phoneNumberId: account.externalId,
      encryptedToken: connection.encryptedToken,
      version: app.graphVersion,
    }
  },
})
export function registerWhatsAppRoutes(http: HttpRouter) {
  channelMessageRoutes("whatsapp")(http, {
    send: async (ctx, { caller, body }) => {
      const input = objectBody(body)
      const tags = arrayField(input, "tags").map((raw) => {
        const tag = objectBody(raw)
        return {
          name: stringField(tag, "name", true)!,
          value: stringField(tag, "value", true)!,
        }
      })
      const messageBody: Record<string, unknown> = {}
      const type = enumField(input, "type", WHATSAPP_SEND_TYPES)
      if (type) messageBody.type = type
      for (const key of WHATSAPP_SEND_TYPES)
        if (input[key] !== undefined) messageBody[key] = input[key]
      const id = await ctx.runMutation(internal.api.whatsapp.send, {
        caller,
        input: {
          to: stringField(input, "to", true)!,
          from: stringField(input, "from"),
          body: messageBody,
          replyTo: stringField(input, "reply_to"),
          tags,
        },
      })
      return { body: { id } }
    },
    media: {
      maxBody: MAX_WHATSAPP_MEDIA_BYTES + 64 * 1024,
      handler: async (ctx, { caller, body }) => {
        const input = objectBody(body)
        const from = stringField(input, "from")
        await ctx.runQuery(internal.api.whatsapp.uploadTarget, { caller, from })
        const file = input.file
        if (!(file instanceof Blob))
          throw invalid("A multipart file is required.")
        const bytes = new Uint8Array(await file.arrayBuffer())
        const contentType = stringField(input, "type") ?? file.type
        try {
          validateWhatsAppMedia(bytes, contentType)
        } catch (error) {
          throw invalid(
            error instanceof Error ? error.message : "Invalid media."
          )
        }
        const storageId = await ctx.storage.store(
          new Blob([bytes], { type: contentType })
        )
        try {
          const id: string = await ctx.runAction(
            internal.channels.mediaUpload.upload,
            {
              caller,
              from,
              storageId,
              filename:
                typeof (file as File).name === "string"
                  ? (file as File).name
                  : "attachment",
              contentType,
            }
          )
          return { body: { id } }
        } catch (error) {
          await ctx.storage.delete(storageId)
          throw error
        }
      },
    },
  })
}
