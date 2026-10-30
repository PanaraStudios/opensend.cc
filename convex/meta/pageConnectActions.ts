"use node"
import { ConvexError, v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { encryptSecret, decryptSecret } from "../secrets"
import {
  graph,
  friendly,
  debugToken,
  numericId,
  manualToken,
  exchangeCode,
  longLivedUserToken,
  unsubscribeAsset,
  markTokenInvalid,
  type App,
  graphFailure,
} from "./graph"
import { connectedPagesValue, pageAccountValue } from "./connect"
import {
  PAGE_FIELDS,
  PAGE_WEBHOOK_FIELDS,
  readPage,
  readPages,
  pageTokenProblem,
  INSTAGRAM_SCOPES,
  type Page,
} from "../../lib/meta/page-account"
import type { Id } from "../_generated/dataModel"
import type { FunctionReturnType } from "convex/server"
import type { TokenInfo } from "../../lib/meta/whatsapp-account"
import { MetaError } from "../../lib/meta/errors"

type Connected = typeof connectedPagesValue.type
async function getPage(
  app: Pick<App, "graphVersion">,
  token: string,
  pageId: string
) {
  const page = readPage(
    await graph({
      token,
      version: app.graphVersion,
      method: "GET",
      path: pageId,
      query: { fields: PAGE_FIELDS },
    })
  )
  if (!page || page.id !== pageId)
    throw new ConvexError("Meta returned no matching Facebook Page")
  return page
}
async function attach(
  ctx: ActionCtx,
  app: App,
  organizationId: string,
  pages: Page[],
  token: string,
  method: "facebook_login" | "manual_token",
  info: TokenInfo
): Promise<Connected> {
  if (pages.length > 100)
    throw new ConvexError("Connect at most 100 Facebook Pages at a time")
  if (!pages.length)
    throw new ConvexError(
      "Meta returned no Facebook Pages with messaging access"
    )
  const accounts: (typeof pageAccountValue.type)[] = []
  // A linked Instagram account joins only when the login allowed it; the
  // Page itself does not need it.
  const instagram = INSTAGRAM_SCOPES.every((scope) =>
    info.scopes.includes(scope)
  )
  for (const page of pages) {
    const problem = pageTokenProblem(info, app.appId, page.id)
    if (problem) throw new ConvexError(problem)
    // Prefer the Page access token; a pasted Page token may already be it.
    const pageToken = page.token ?? token
    const encryptedToken = await encryptSecret(pageToken)
    accounts.push({
      channel: "messenger",
      externalId: page.id,
      pageId: page.id,
      displayName: page.name,
      handle: page.name,
      encryptedToken,
      tokenLast4: pageToken.slice(-4),
    })
    if (page.instagram && instagram)
      accounts.push({
        channel: "instagram",
        externalId: page.instagram.id,
        pageId: page.id,
        displayName: page.instagram.name,
        handle: page.instagram.username,
        encryptedToken,
        tokenLast4: pageToken.slice(-4),
      })
  }
  await ctx.runQuery(internal.meta.connect.checkPages, {
    organizationId,
    scopes: info.scopes,
    accounts: accounts.map(({ channel, externalId, pageId }) => ({
      channel,
      externalId,
      pageId,
    })),
  })
  for (const page of pages) {
    const result = await graph<{ success?: boolean }>({
      token: page.token ?? token,
      version: app.graphVersion,
      method: "POST",
      path: `${page.id}/subscribed_apps`,
      body: { form: { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(",") } },
    })
    if (result.success !== true)
      throw new ConvexError("Meta did not confirm the webhook subscription")
  }
  return ctx.runMutation(internal.meta.connect.storePages, {
    organizationId,
    method,
    scopes: info.scopes,
    accounts,
  })
}

/** Facebook Login for Business uses the same installation app as WhatsApp.
    The login configuration decides what the browser gets: a "User access
    token" configuration returns a user token (its codes are bound to the
    SDK's hidden redirect URI and cannot be exchanged here), a "System-user
    access token" one a code. */
export const connectFacebookLogin = action({
  args: {
    organizationId: v.string(),
    code: v.optional(v.string()),
    accessToken: v.optional(v.string()),
  },
  returns: connectedPagesValue,
  handler: async (
    ctx,
    { organizationId, code, accessToken }
  ): Promise<Connected> => {
    const app = await ctx.runQuery(internal.meta.connect.teamApp, {
      organizationId,
    })
    const login = (accessToken ?? code)?.trim()
    if (!login || login.length > 2048)
      throw new ConvexError("Meta returned no login code. Try again.")
    return friendly(ctx, async () => {
      const received = accessToken
        ? login
        : await exchangeCode(
            app,
            login,
            "Meta returned no login code. Try again.",
            "Meta returned no access token"
          )
      // Checked before anything else: a token from another app is refused.
      const info = await debugToken(app, received)
      const problem = pageTokenProblem(info, app.appId)
      if (problem) throw new ConvexError(problem)
      // A browser user token lasts hours; Page tokens read with a
      // long-lived one do not expire.
      const token = accessToken
        ? await longLivedUserToken(app, received)
        : received
      const pages: Page[] = []
      let after: string | undefined
      // Follow Graph cursors without fetching its untrusted paging.next URL.
      for (let i = 0; i < 10; i++) {
        const response = await graph<{
          data?: unknown
          paging?: { next?: string; cursors?: { after?: string } }
        }>({
          token,
          version: app.graphVersion,
          method: "GET",
          path: "me/accounts",
          query: {
            fields: PAGE_FIELDS,
            limit: 100,
            ...(after ? { after } : {}),
          },
        })
        pages.push(...readPages(response))
        if (pages.length > 100)
          throw new ConvexError("Connect at most 100 Facebook Pages at a time")
        after = response.paging?.next
          ? response.paging.cursors?.after
          : undefined
        if (!after) break
        if (i === 9)
          throw new ConvexError("Connect at most 100 Facebook Pages at a time")
      }
      // A Page Meta returns without a token (the person cannot message for
      // it) is skipped rather than failing the others.
      const usable = pages.filter((page) => page.token)
      if (pages.length && !usable.length)
        throw new ConvexError("Meta returned no Page access token")
      return attach(
        ctx,
        app,
        organizationId,
        usable,
        token,
        "facebook_login",
        info
      )
    })
  },
})
export const connectPageManual = action({
  args: { organizationId: v.string(), pageId: v.string(), token: v.string() },
  returns: connectedPagesValue,
  handler: async (ctx, args): Promise<Connected> => {
    const app = await ctx.runQuery(internal.meta.connect.teamApp, {
      organizationId: args.organizationId,
    })
    const pageId = numericId(args.pageId, "Facebook Page ID"),
      token = manualToken(
        args.token,
        "Paste the Page or system user access token from Meta"
      )
    return friendly(ctx, async () => {
      const info = await debugToken(app, token),
        problem = pageTokenProblem(info, app.appId, pageId)
      if (problem) throw new ConvexError(problem)
      return attach(
        ctx,
        app,
        args.organizationId,
        [await getPage(app, token, pageId)],
        token,
        "manual_token",
        info
      )
    })
  },
})
type AccountTarget = FunctionReturnType<
  typeof internal.meta.connect.accountTarget
>
type ConnectionTarget = NonNullable<
  FunctionReturnType<typeof internal.meta.connect.connectionTarget>
>
export async function syncPageAccount(
  ctx: ActionCtx,
  accountId: Id<"channelAccounts">,
  target: AccountTarget
) {
  await friendly(
    ctx,
    async () => {
      const page = await getPage(
        target,
        await decryptSecret(target.encryptedToken),
        target.pageId ?? target.externalId
      )
      await ctx.runMutation(internal.meta.pageState.refresh, {
        accountId,
        pageId: page.id,
        name: page.name,
        instagram: page.instagram,
      })
    },
    target.connectionId
  )
  return null
}
export const sync = internalAction({
  args: { accountId: v.id("channelAccounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }): Promise<null> =>
    syncPageAccount(
      ctx,
      accountId,
      await ctx.runQuery(internal.meta.connect.accountTarget, { accountId })
    ),
})
export async function checkPageConnection(
  ctx: ActionCtx,
  connectionId: Id<"metaConnections">,
  target: ConnectionTarget
) {
  try {
    for (const page of target.pages) {
      const token = await decryptSecret(page.encryptedToken),
        info = await debugToken(target, token)
      const problem = pageTokenProblem(info, target.appId, page.pageId)
      if (problem) {
        await ctx.runMutation(internal.meta.connect.markConnection, {
          connectionId,
          status: "error",
          error: problem,
        })
        return null
      }
      const refreshed = await getPage(target, token, page.pageId)
      await ctx.runMutation(internal.meta.pageState.refresh, {
        accountId: page.id,
        pageId: refreshed.id,
        name: refreshed.name,
        instagram: refreshed.instagram,
      })
    }
    await ctx.runMutation(internal.meta.connect.markConnection, {
      connectionId,
      status: "active",
    })
  } catch (error) {
    if (error instanceof MetaError && error.action === "token_invalid")
      await markTokenInvalid(ctx, connectionId)
    else
      await ctx.runMutation(internal.meta.connect.markConnection, {
        connectionId,
        status: "active",
        error: graphFailure(error),
      })
  }
  return null
}
export const checkConnection = internalAction({
  args: { connectionId: v.id("metaConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }): Promise<null> => {
    const target = await ctx.runQuery(internal.meta.connect.connectionTarget, {
      connectionId,
    })
    return target?.status === "active"
      ? checkPageConnection(ctx, connectionId, target)
      : null
  },
})
export const unsubscribe = internalAction({
  args: {
    pages: v.array(
      v.object({ pageId: v.string(), encryptedToken: v.string() })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { pages }) => {
    const version = await ctx.runQuery(internal.meta.pageState.version, {})
    if (!version) return null
    for (const page of pages)
      await unsubscribeAsset({
        id: page.pageId,
        label: "Page",
        version,
        token: () => decryptSecret(page.encryptedToken),
        connected: () =>
          ctx.runQuery(internal.meta.connect.pageConnected, {
            pageId: page.pageId,
          }),
      })
    return null
  },
})

/** Best-effort profile enrichment after inbound is committed. */
export const profile = internalAction({
  args: {
    identityId: v.id("channelContacts"),
    accountId: v.id("channelAccounts"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(
      internal.meta.pageState.profileTarget,
      args
    )
    if (!target) return null
    try {
      const data = await graph<{
        first_name?: string
        last_name?: string
        name?: string
        username?: string
      }>({
        token: await decryptSecret(target.encryptedToken),
        version: target.version,
        method: "GET",
        path: target.externalId,
        query: {
          fields:
            target.channel === "messenger"
              ? "first_name,last_name"
              : "name,username,profile_pic",
        },
      })
      const name =
        target.channel === "messenger"
          ? [data.first_name, data.last_name]
              .filter((part) => typeof part === "string")
              .join(" ")
          : data.name || ""
      if (typeof name === "string")
        await ctx.runMutation(internal.meta.pageState.profileComplete, {
          identityId: args.identityId,
          name,
          username:
            target.channel === "instagram" && typeof data.username === "string"
              ? data.username
              : undefined,
        })
    } catch {
      /* Profile permission failures do not lose incoming messages. */
    }
    return null
  },
})
