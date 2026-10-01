"use node"
import { ConvexError, v } from "convex/values"
import { action, internalAction, type ActionCtx } from "../_generated/server"
import { internal } from "../_generated/api"
import { encryptSecret, decryptSecret } from "../secrets"
import {
  graph,
  friendly,
  appAccessToken,
  graphFailure,
  TOKEN_REFUSED,
} from "./graph"
import { debugToken, numericId, type App } from "./connectActions"
import { connectedPagesValue, pageAccountValue } from "./connect"
import {
  PAGE_FIELDS,
  PAGE_WEBHOOK_FIELDS,
  readPage,
  readPages,
  pageTokenProblem,
  type Page,
} from "../../lib/meta/page-account"
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
  for (const page of pages) {
    const problem = pageTokenProblem(info, app.appId, page.id, !!page.instagram)
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
    if (page.instagram)
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
    accounts: accounts.map(({ channel, externalId }) => ({
      channel,
      externalId,
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

/** Facebook Login for Business uses the same installation app as WhatsApp. */
export const connectFacebookLogin = action({
  args: { organizationId: v.string(), code: v.string() },
  returns: connectedPagesValue,
  handler: async (ctx, { organizationId, code }): Promise<Connected> => {
    const app = await ctx.runQuery(internal.meta.connect.teamApp, {
      organizationId,
    })
    if (!code.trim() || code.length > 2048)
      throw new ConvexError("Meta returned no login code. Try again.")
    return friendly(ctx, async () => {
      const exchanged = await graph<{ access_token?: unknown }>({
        token: await appAccessToken(app),
        version: app.graphVersion,
        method: "GET",
        path: "oauth/access_token",
        query: {
          client_id: app.appId,
          client_secret: await decryptSecret(app.encryptedAppSecret),
          code: code.trim(),
        },
      })
      if (typeof exchanged.access_token !== "string" || !exchanged.access_token)
        throw new ConvexError("Meta returned no access token")
      const token = exchanged.access_token
      const info = await debugToken(app, token)
      const problem = pageTokenProblem(info, app.appId)
      if (problem) throw new ConvexError(problem)
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
      if (pages.some((page) => !page.token))
        throw new ConvexError("Meta returned no Page access token")
      return attach(
        ctx,
        app,
        organizationId,
        pages,
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
      token = args.token.trim()
    if (!/^[A-Za-z0-9_|-]{20,1024}$/.test(token))
      throw new ConvexError(
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
export const sync = internalAction({
  args: { accountId: v.id("channelAccounts") },
  returns: v.null(),
  handler: async (ctx, { accountId }): Promise<null> => {
    const target = await ctx.runQuery(internal.meta.connect.accountTarget, {
      accountId,
    })
    await friendly(
      ctx,
      async () => {
        const token = await decryptSecret(target.encryptedToken),
          page = await getPage(
            target,
            token,
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
  },
})
export const checkConnection = internalAction({
  args: { connectionId: v.id("metaConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const target = await ctx.runQuery(internal.meta.connect.connectionTarget, {
      connectionId,
    })
    if (target?.status !== "active") return null
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
      await ctx.runMutation(internal.meta.connect.markConnection, {
        connectionId,
        status:
          error instanceof MetaError && error.action === "token_invalid"
            ? "error"
            : "active",
        error:
          error instanceof MetaError && error.action === "token_invalid"
            ? TOKEN_REFUSED
            : graphFailure(error),
      })
    }
    return null
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
    for (const page of pages) {
      if (
        await ctx.runQuery(internal.meta.connect.pageConnected, {
          pageId: page.pageId,
        })
      )
        continue
      try {
        await graph({
          token: await decryptSecret(page.encryptedToken),
          version,
          method: "DELETE",
          path: `${page.pageId}/subscribed_apps`,
        })
      } catch (error) {
        console.warn(
          `Could not unsubscribe Page ${page.pageId}: ${graphFailure(error)}`
        )
      }
    }
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
              : "name,username",
        },
      })
      const name =
        target.channel === "messenger"
          ? [data.first_name, data.last_name]
              .filter((part) => typeof part === "string")
              .join(" ")
          : data.name || data.username || ""
      if (typeof name === "string")
        await ctx.runMutation(internal.meta.pageState.profileComplete, {
          identityId: args.identityId,
          name,
        })
    } catch {
      /* Profile permission failures do not lose incoming messages. */
    }
    return null
  },
})
