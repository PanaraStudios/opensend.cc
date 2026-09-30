import { v, ConvexError, type Infer } from "convex/values"
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import {
  findInstallation,
  requireInstallationAdmin,
  requireTeam,
} from "../access"
import { decryptSecret, encryptSecret } from "../secrets"
import { metaConfigIdsValue } from "../tables/meta"
import { createToken } from "../../lib/dashboard/ids"
import { DEFAULT_GRAPH_VERSION, isGraphVersion } from "../../lib/meta/graph-url"
import { sameSecret } from "../../lib/meta/signature"

const ADMIN_ONLY = "Only the installation administrator can configure Meta"
/** Where Meta delivers webhooks and verifies the subscription. */
export const META_WEBHOOK_PATH = "/meta/webhook"
export const metaWebhookUrl = (callbackOrigin: string) =>
  `${callbackOrigin}${META_WEBHOOK_PATH}`

/** The installation's Meta app, a singleton. */
export const findMetaApp = (ctx: QueryCtx | MutationCtx) =>
  ctx.db
    .query("metaApps")
    .withIndex("by_key", (q) => q.eq("key", "metaApp"))
    .unique()

const requireAdmin = (ctx: Parameters<typeof requireInstallationAdmin>[0]) =>
  requireInstallationAdmin(ctx, ADMIN_ONLY)

/* The app secret never leaves the backend; the dashboard sees its last four
   characters. The verify token is shown to the admin, who may need it to
   set the callback up in Meta's dashboard by hand. */
export const status = query({
  args: {},
  returns: v.object({
    connected: v.boolean(),
    appId: v.optional(v.string()),
    appName: v.optional(v.string()),
    secretLast4: v.optional(v.string()),
    graphVersion: v.string(),
    configIds: metaConfigIdsValue,
    verifiedAt: v.optional(v.number()),
    webhookSubscribedAt: v.optional(v.number()),
    callbackUrl: v.union(v.null(), v.string()),
    verifyToken: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const app = await findMetaApp(ctx)
    const installation = await findInstallation(ctx)
    const callbackUrl = installation?.callbackOrigin
      ? metaWebhookUrl(installation.callbackOrigin)
      : null
    const configIds: Infer<typeof metaConfigIdsValue> = app?.configIds ?? {}
    if (!app)
      return {
        connected: false,
        graphVersion: DEFAULT_GRAPH_VERSION,
        configIds,
        callbackUrl,
      }
    return {
      connected: true,
      appId: app.appId,
      appName: app.appName,
      secretLast4: app.secretLast4,
      graphVersion: app.graphVersion,
      configIds,
      verifiedAt: app.verifiedAt,
      webhookSubscribedAt: app.webhookSubscribedAt,
      callbackUrl,
      verifyToken: await decryptSecret(app.encryptedVerifyToken),
      error: app.error,
    }
  },
})

/** What a team's dashboard needs to open Embedded Signup: the public app
    ID, configuration IDs and Graph version. Never a secret. */
export const publicConfig = query({
  args: { organizationId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    appId: v.optional(v.string()),
    configIds: metaConfigIdsValue,
    graphVersion: v.string(),
  }),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    const app = await findMetaApp(ctx)
    if (!app)
      return {
        configured: false,
        configIds: {},
        graphVersion: DEFAULT_GRAPH_VERSION,
      }
    return {
      configured: true,
      appId: app.appId,
      configIds: app.configIds,
      graphVersion: app.graphVersion,
    }
  },
})

const saveArgs = {
  appId: v.string(),
  /** Required on the first save and when the app ID changes. */
  appSecret: v.optional(v.string()),
  graphVersion: v.string(),
  configIds: metaConfigIdsValue,
}
const trimmed = (value?: string) => value?.trim() || undefined
function validated(args: {
  appId: string
  appSecret?: string
  graphVersion: string
  configIds: { whatsapp?: string; facebookLogin?: string }
}) {
  const appId = args.appId.trim()
  if (!/^\d{1,32}$/.test(appId))
    throw new ConvexError("Enter the numeric app ID from Meta's App Dashboard")
  const appSecret = trimmed(args.appSecret)
  if (appSecret !== undefined && !/^[A-Za-z0-9]{16,128}$/.test(appSecret))
    throw new ConvexError("Enter the app secret from Meta's App Dashboard")
  const graphVersion = args.graphVersion.trim()
  if (!isGraphVersion(graphVersion))
    throw new ConvexError("Enter a Graph API version like v25.0")
  const configIds = {
    whatsapp: trimmed(args.configIds.whatsapp),
    facebookLogin: trimmed(args.configIds.facebookLogin),
  }
  for (const id of Object.values(configIds))
    if (id !== undefined && !/^\d{1,32}$/.test(id))
      throw new ConvexError("Configuration IDs are numeric")
  return { appId, appSecret, graphVersion, configIds }
}

/* Secrets are generated and encrypted here rather than in a mutation, whose
   random source is seeded for determinism. */
export const save = action({
  args: saveArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await requireAdmin(ctx)
    const { appSecret, ...rest } = validated(args)
    await ctx.runMutation(internal.meta.app.store, {
      ...rest,
      ...(appSecret
        ? {
            encryptedAppSecret: await encryptSecret(appSecret),
            secretLast4: appSecret.slice(-4),
          }
        : {}),
      encryptedVerifyToken: await encryptSecret(createToken()),
    })
    return null
  },
})

export const store = internalMutation({
  args: {
    appId: v.string(),
    graphVersion: v.string(),
    configIds: metaConfigIdsValue,
    encryptedAppSecret: v.optional(v.string()),
    secretLast4: v.optional(v.string()),
    /** Used only when the app has no verify token yet. */
    encryptedVerifyToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    const app = await findMetaApp(ctx)
    const newApp = app?.appId !== args.appId
    if ((!app || newApp) && !args.encryptedAppSecret)
      throw new ConvexError("Enter the app secret")
    const credentials = args.encryptedAppSecret
      ? {
          encryptedAppSecret: args.encryptedAppSecret,
          secretLast4: args.secretLast4!,
        }
      : {}
    if (!app) {
      await ctx.db.insert("metaApps", {
        key: "metaApp",
        appId: args.appId,
        graphVersion: args.graphVersion,
        configIds: args.configIds,
        encryptedAppSecret: args.encryptedAppSecret!,
        secretLast4: args.secretLast4!,
        encryptedVerifyToken: args.encryptedVerifyToken,
      })
      return null
    }
    // New credentials must be verified again; a new app, subscribed again.
    const changed = newApp || !!args.encryptedAppSecret
    await ctx.db.patch("metaApps", app._id, {
      appId: args.appId,
      graphVersion: args.graphVersion,
      configIds: args.configIds,
      ...credentials,
      ...(changed
        ? { appName: undefined, verifiedAt: undefined, error: undefined }
        : {}),
      ...(newApp ? { webhookSubscribedAt: undefined } : {}),
    })
    return null
  },
})

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const app = await findMetaApp(ctx)
    if (app) await ctx.db.delete("metaApps", app._id)
    return null
  },
})

/** What the Graph actions need: the app, its callback URL and ciphertexts. */
export const credentials = internalQuery({
  args: {},
  returns: v.object({
    appId: v.string(),
    graphVersion: v.string(),
    encryptedAppSecret: v.string(),
    encryptedVerifyToken: v.string(),
    callbackUrl: v.union(v.null(), v.string()),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const app = await findMetaApp(ctx)
    if (!app) throw new ConvexError("Save the Meta app first")
    const installation = await findInstallation(ctx)
    return {
      appId: app.appId,
      graphVersion: app.graphVersion,
      encryptedAppSecret: app.encryptedAppSecret,
      encryptedVerifyToken: app.encryptedVerifyToken,
      callbackUrl: installation?.callbackOrigin
        ? metaWebhookUrl(installation.callbackOrigin)
        : null,
    }
  },
})

/** Records a Graph action's outcome for the app it ran against; a result
    for an app that has since changed is dropped. */
export const record = internalMutation({
  args: {
    appId: v.string(),
    appName: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    webhookSubscribedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { appId, ...result }) => {
    await requireAdmin(ctx)
    const app = await findMetaApp(ctx)
    if (!app || app.appId !== appId) return null
    // A success clears the previous failure.
    await ctx.db.patch("metaApps", app._id, { ...result, error: result.error })
    return null
  },
})

/** Whether `token` is the app's webhook verify token. */
export const matchesVerifyToken = internalQuery({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { token }) => {
    const app = await findMetaApp(ctx)
    if (!app) return false
    return sameSecret(token, await decryptSecret(app.encryptedVerifyToken))
  },
})
