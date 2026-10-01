"use node"
import { v, ConvexError } from "convex/values"
import { action, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { decryptSecret } from "../secrets"
import {
  PAGE_WEBHOOK_FIELDS,
  INSTAGRAM_WEBHOOK_FIELDS,
} from "../../lib/meta/page-account"
import { appAccessToken, graph, graphFailure } from "./graph"

/** The WhatsApp Business Account fields opensend.cc projects. */
export const WHATSAPP_WEBHOOK_FIELDS = [
  "messages",
  "message_template_status_update",
  "template_category_update",
  "phone_number_quality_update",
  "account_update",
  "phone_number_name_update",
] as const

/** Runs a Graph call with the app access token (`appId|appSecret`) and
    records its outcome or failure on the app. */
async function withApp<T>(
  ctx: ActionCtx,
  run: (app: {
    appId: string
    graphVersion: string
    token: string
    verifyToken: string
    callbackUrl: string | null
  }) => Promise<T>,
  recorded: (result: T) => {
    appName?: string
    verifiedAt?: number
    webhookSubscribedAt?: number
  }
) {
  const app = await ctx.runQuery(internal.meta.app.credentials, {})
  try {
    const result = await run({
      appId: app.appId,
      graphVersion: app.graphVersion,
      token: await appAccessToken(app),
      verifyToken: await decryptSecret(app.encryptedVerifyToken),
      callbackUrl: app.callbackUrl,
    })
    await ctx.runMutation(internal.meta.app.record, {
      appId: app.appId,
      ...recorded(result),
    })
  } catch (e) {
    const message = graphFailure(e)
    await ctx.runMutation(internal.meta.app.record, {
      appId: app.appId,
      error: message,
    })
    throw new ConvexError(message)
  }
  return null
}

/** Checks the app ID and secret: `GET /{app-id}?fields=id,name`. */
export const verify = action({
  args: {},
  returns: v.null(),
  handler: (ctx) =>
    withApp(
      ctx,
      async (app) => {
        const result = await graph<{ id?: string; name?: string }>({
          token: app.token,
          method: "GET",
          path: app.appId,
          query: { fields: "id,name" },
          version: app.graphVersion,
        })
        if (result.id !== app.appId)
          throw new ConvexError("Meta returned a different app")
        return result
      },
      (result) => ({ appName: result.name, verifiedAt: Date.now() })
    ),
})

/** Subscribes the app to WhatsApp Business Account webhooks. Meta checks
    the callback with a GET to /meta/webhook before it answers. */
export const subscribeWebhooks = action({
  args: {},
  returns: v.null(),
  handler: (ctx) =>
    withApp(
      ctx,
      async (app) => {
        if (!app.callbackUrl)
          throw new ConvexError("Set the backend URL on the Amazon SES page")
        for (const [object, fields] of [
          ["whatsapp_business_account", WHATSAPP_WEBHOOK_FIELDS],
          ["page", PAGE_WEBHOOK_FIELDS],
          ["instagram", INSTAGRAM_WEBHOOK_FIELDS],
        ] as const) {
          const result = await graph<{ success?: boolean }>({
            token: app.token,
            method: "POST",
            path: `${app.appId}/subscriptions`,
            version: app.graphVersion,
            body: {
              form: {
                object,
                callback_url: app.callbackUrl,
                verify_token: app.verifyToken,
                fields: fields.join(","),
                include_values: "true",
              },
            },
          })
          if (result.success !== true)
            throw new ConvexError("Meta did not confirm the subscription")
        }
        return null
      },
      () => ({ webhookSubscribedAt: Date.now() })
    ),
})
