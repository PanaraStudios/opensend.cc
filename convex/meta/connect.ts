import { v, ConvexError } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import schema from "../schema"
import { requireTeam } from "../access"
import { readTeamRow } from "../lists"
import { countValue, counters, insertRow, literals, patchRow } from "../counts"
import {
  metaConnectionMethodValue,
  metaConnectionStatusValue,
} from "../tables/meta"
import { channelQualityValue, messagingChannelValue } from "../tables/channels"
import { findMetaApp } from "./app"
import { NUMBER_LIMIT, registration } from "../../lib/meta/whatsapp-account"

/* A team's Meta connections and the sending endpoints they bring. The Graph
   calls live in connectActions.ts; everything here reads or writes rows. A
   WhatsApp Business Account belongs to one team at a time, and disconnecting
   keeps every message: accounts are marked disconnected, never deleted. */

export const APP_MISSING = "Your administrator needs to set up the Meta app"
export const WABA_TAKEN =
  "This WhatsApp Business Account is already connected to another team"
const NOT_FOUND = "Channel not found"

/** A phone number as a Graph action read it (lib/meta/whatsapp-account.ts). */
export const phoneNumberValue = v.object({
  externalId: v.string(),
  displayName: v.string(),
  handle: v.string(),
  status: v.union(
    v.literal("pending"),
    v.literal("active"),
    v.literal("restricted"),
    v.literal("error")
  ),
  quality: channelQualityValue,
  throughputMps: v.number(),
  messagingLimit: v.optional(v.string()),
  registered: v.optional(v.boolean()),
})
type PhoneNumber = typeof phoneNumberValue.type

/** Connections and accounts as the dashboard sees them: never a token. */
const connectionValue = schema.doc("metaConnections").omit("encryptedToken")
const accountValue = schema
  .doc("channelAccounts")
  .omit("encryptedToken")
  .extend({ businessName: v.string() })

function publicConnection(connection: Doc<"metaConnections">) {
  const { encryptedToken: _token, ...rest } = connection
  void _token
  return rest
}

async function publicAccount(ctx: QueryCtx, account: Doc<"channelAccounts">) {
  const { encryptedToken: _token, ...rest } = account
  void _token
  const connection = await ctx.db.get("metaConnections", account.connectionId)
  return { ...rest, businessName: connection?.businessName ?? "" }
}

/** A number still connected; a disconnected team keeps its row, so one
    phone number id can have several rows over time. */
export const live = (account: Doc<"channelAccounts">) =>
  account.disconnectedAt === undefined

export const listConnections = query({
  args: { organizationId: v.string() },
  returns: v.array(connectionValue),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    const rows = await ctx.db
      .query("metaConnections")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .order("desc")
      .take(100)
    return rows
      .filter((row) => row.status !== "disconnected")
      .map(publicConnection)
  },
})

const accountFilters = {
  organizationId: v.string(),
  channel: v.optional(messagingChannelValue),
}

/** The team's connected sending endpoints, newest first. */
export const listAccounts = query({
  args: { ...accountFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(accountValue),
  handler: async (ctx, { organizationId, channel, paginationOpts }) => {
    await requireTeam(ctx, organizationId, "read")
    const accounts = ctx.db.query("channelAccounts")
    const page = await (
      channel
        ? accounts.withIndex(
            "by_organizationId_and_channel_and_disconnectedAt",
            (q) =>
              q
                .eq("organizationId", organizationId)
                .eq("channel", channel)
                .eq("disconnectedAt", undefined)
          )
        : accounts.withIndex("by_organizationId_and_disconnectedAt", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("disconnectedAt", undefined)
          )
    )
      .order("desc")
      .paginate(paginationOpts)
    return {
      ...page,
      page: await Promise.all(
        page.page.map((account) => publicAccount(ctx, account))
      ),
    }
  },
})

export const countAccounts = query({
  args: accountFilters,
  returns: countValue,
  handler: async (ctx, { organizationId, channel }) => {
    await requireTeam(ctx, organizationId, "read")
    return {
      total: await counters.channelAccounts.total(ctx, organizationId, [
        { is: channel, among: literals(messagingChannelValue) },
      ]),
    }
  },
})

export const getAccount = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      account: accountValue,
      connection: connectionValue,
      wabaName: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { id }) => {
    const account = await readTeamRow(ctx, "channelAccounts", id, {
      beforeAccess: live,
    })
    if (!account) return null
    const connection = await ctx.db.get("metaConnections", account.connectionId)
    if (!connection) return null
    const waba = account.wabaId
      ? await ctx.db
          .query("whatsappBusinessAccounts")
          .withIndex("by_wabaId", (q) => q.eq("wabaId", account.wabaId!))
          .unique()
      : null
    return {
      account: await publicAccount(ctx, account),
      connection: publicConnection(connection),
      wabaName:
        waba?.organizationId === account.organizationId ? waba.name : undefined,
    }
  },
})

/* ------------------------------------------------ for connectActions.ts */

/** The app a team connects through, for a caller who may write. */
export const teamApp = internalQuery({
  args: { organizationId: v.string() },
  returns: v.object({
    appId: v.string(),
    graphVersion: v.string(),
    encryptedAppSecret: v.string(),
  }),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "write")
    const app = await findMetaApp(ctx)
    if (!app) throw new ConvexError(APP_MISSING)
    return {
      appId: app.appId,
      graphVersion: app.graphVersion,
      encryptedAppSecret: app.encryptedAppSecret,
    }
  },
})

async function assertWabaFree(
  ctx: QueryCtx,
  { organizationId, wabaId }: { organizationId: string; wabaId: string }
) {
  const waba = await ctx.db
    .query("whatsappBusinessAccounts")
    .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
    .unique()
  if (waba && waba.organizationId !== organizationId)
    throw new ConvexError(WABA_TAKEN)
  return waba
}

/** Whether a team holds the WABA now: a late cleanup leaves it alone. */
export const wabaConnected = internalQuery({
  args: { wabaId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { wabaId }) =>
    (await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
      .unique()) !== null,
})

/** Refuses a WABA another team connected, before any Graph call touches it. */
export const checkWaba = internalQuery({
  args: { organizationId: v.string(), wabaId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    await assertWabaFree(ctx, args)
    return null
  },
})

/** Saves the number over the team's row for it, or adds one. A number keeps
    its row, and so its messages, across reconnects by the same team. */
async function upsertNumber(
  ctx: MutationCtx,
  input: {
    organizationId: string
    connectionId: Id<"metaConnections">
    wabaId: string
    number: PhoneNumber
    now: number
  }
) {
  const { organizationId, number, now } = input
  const rows = await ctx.db
    .query("channelAccounts")
    .withIndex("by_channel_and_externalId", (q) =>
      q.eq("channel", "whatsapp").eq("externalId", number.externalId)
    )
    .take(20)
  if (rows.some((row) => row.organizationId !== organizationId && live(row)))
    throw new ConvexError(WABA_TAKEN)
  const existing = rows.find((row) => row.organizationId === organizationId)
  const fields = {
    connectionId: input.connectionId,
    wabaId: input.wabaId,
    displayName: number.displayName,
    handle: number.handle,
    quality: number.quality,
    throughputMps: number.throughputMps,
    messagingLimit: number.messagingLimit,
    ...registration(number, existing?.registeredAt, now),
    checkedAt: now,
    error: undefined,
    disconnectedAt: undefined,
  }
  if (existing) {
    await patchRow(ctx, "channelAccounts", existing._id, fields)
    return existing._id
  }
  return insertRow(ctx, "channelAccounts", {
    organizationId,
    channel: "whatsapp",
    externalId: number.externalId,
    ...fields,
  })
}

async function saveNumbers(
  ctx: MutationCtx,
  input: {
    organizationId: string
    connectionId: Id<"metaConnections">
    wabaId: string
    numbers: PhoneNumber[]
  }
) {
  const now = Date.now()
  const saved = []
  for (const number of input.numbers.slice(0, NUMBER_LIMIT)) {
    const id = await upsertNumber(ctx, { ...input, number, now })
    const account = (await ctx.db.get("channelAccounts", id))!
    saved.push({
      id,
      handle: account.handle,
      registered: account.registeredAt !== undefined,
    })
  }
  return saved
}

/** Shared connection upsert for WABAs and Pages. */
async function saveConnection(
  ctx: MutationCtx,
  args: {
    organizationId: string
    businessId: string
    businessName: string
    method: Doc<"metaConnections">["method"]
    encryptedToken: string
    tokenLast4: string
    scopes: string[]
  }
) {
  const connection = (
    await ctx.db
      .query("metaConnections")
      .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
      .take(50)
  ).find((row) => row.organizationId === args.organizationId)
  const fields = {
    businessName: args.businessName,
    method: args.method,
    encryptedToken: args.encryptedToken,
    tokenLast4: args.tokenLast4,
    scopes: args.scopes,
    status: "active" as const,
    checkedAt: Date.now(),
    error: undefined,
  }
  if (connection) {
    await ctx.db.patch("metaConnections", connection._id, fields)
    return connection._id
  }
  return ctx.db.insert("metaConnections", {
    organizationId: args.organizationId,
    businessId: args.businessId,
    ...fields,
  })
}

export const pageAccountValue = v.object({
  channel: v.union(v.literal("messenger"), v.literal("instagram")),
  externalId: v.string(),
  pageId: v.string(),
  displayName: v.string(),
  handle: v.string(),
  encryptedToken: v.string(),
  tokenLast4: v.string(),
})
export const connectedPagesValue = v.object({
  accounts: v.array(
    v.object({
      id: v.id("channelAccounts"),
      channel: v.union(v.literal("messenger"), v.literal("instagram")),
      handle: v.string(),
    })
  ),
})
export const PAGE_TAKEN =
  "This Facebook Page or Instagram account is already connected to another team"
async function pageRows(
  ctx: QueryCtx,
  channel: "messenger" | "instagram",
  externalId: string
) {
  return ctx.db
    .query("channelAccounts")
    .withIndex("by_channel_and_externalId", (q) =>
      q.eq("channel", channel).eq("externalId", externalId)
    )
    .take(20)
}
async function assertPagesFree(
  ctx: QueryCtx,
  organizationId: string,
  accounts: { channel: "messenger" | "instagram"; externalId: string }[]
) {
  for (const account of accounts) {
    if (
      (await pageRows(ctx, account.channel, account.externalId)).some(
        (row) => row.organizationId !== organizationId && live(row)
      )
    )
      throw new ConvexError(PAGE_TAKEN)
  }
}
export const checkPages = internalQuery({
  args: {
    organizationId: v.string(),
    accounts: v.array(pageAccountValue.pick("channel", "externalId")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    await assertPagesFree(ctx, args.organizationId, args.accounts)
    return null
  },
})
export const storePages = internalMutation({
  args: {
    organizationId: v.string(),
    method: metaConnectionMethodValue,
    scopes: v.array(v.string()),
    accounts: v.array(pageAccountValue),
  },
  returns: connectedPagesValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    await assertPagesFree(ctx, args.organizationId, args.accounts)
    const now = Date.now(),
      saved = []
    const connections = new Map<string, Id<"metaConnections">>()
    for (const account of args.accounts) {
      let connectionId = connections.get(account.pageId)
      if (!connectionId) {
        connectionId = await saveConnection(ctx, {
          organizationId: args.organizationId,
          businessId: `page:${account.pageId}`,
          businessName:
            args.accounts.find(
              (a) => a.channel === "messenger" && a.pageId === account.pageId
            )?.displayName ?? account.displayName,
          method: args.method,
          encryptedToken: account.encryptedToken,
          tokenLast4: account.tokenLast4,
          scopes: args.scopes,
        })
        connections.set(account.pageId, connectionId)
        // Reconnecting a Page may replace or unlink its Instagram account.
        // Retire the old endpoint while preserving its messages and identity scope.
        const previous = await ctx.db
          .query("channelAccounts")
          .withIndex("by_connectionId", (q) =>
            q.eq("connectionId", connectionId!)
          )
          .take(500)
        for (const row of previous) {
          if (
            row.channel === "instagram" &&
            row.pageId === account.pageId &&
            live(row) &&
            !args.accounts.some(
              (next) =>
                next.channel === "instagram" &&
                next.externalId === row.externalId &&
                next.pageId === row.pageId
            )
          )
            await patchRow(ctx, "channelAccounts", row._id, {
              status: "disconnected",
              disconnectedAt: now,
            })
        }
      }
      const existing = (
        await pageRows(ctx, account.channel, account.externalId)
      ).find((row) => row.organizationId === args.organizationId)
      const { tokenLast4: _last4, ...accountFields } = account
      void _last4
      const fields = {
        ...accountFields,
        connectionId,
        status: "active" as const,
        // Meta Send API: 300 calls/s; audio/video have a separate 10/s bucket.
        throughputMps: 300,
        checkedAt: now,
        registeredAt: existing?.registeredAt ?? now,
        disconnectedAt: undefined,
        error: undefined,
      }
      const id = existing
        ? (await patchRow(ctx, "channelAccounts", existing._id, fields))._id
        : await insertRow(ctx, "channelAccounts", {
            organizationId: args.organizationId,
            ...fields,
          })
      saved.push({ id, channel: account.channel, handle: account.handle })
    }
    return { accounts: saved }
  },
})
export const pageConnected = internalQuery({
  args: { pageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { pageId }) =>
    (await pageRows(ctx, "messenger", pageId)).some(live),
})

/** Stores a connected business, its WABA and numbers in one transaction.
    The connection is keyed by team and business; the WABA is refused when
    another team holds it. */
export const store = internalMutation({
  args: {
    organizationId: v.string(),
    businessId: v.string(),
    businessName: v.string(),
    method: metaConnectionMethodValue,
    encryptedToken: v.string(),
    tokenLast4: v.string(),
    scopes: v.array(v.string()),
    wabaId: v.string(),
    wabaName: v.optional(v.string()),
    numbers: v.array(phoneNumberValue),
  },
  returns: v.object({
    connectionId: v.id("metaConnections"),
    accounts: v.array(
      v.object({
        id: v.id("channelAccounts"),
        handle: v.string(),
        registered: v.boolean(),
      })
    ),
  }),
  handler: async (ctx, args) => {
    const { organizationId, wabaId } = args
    await requireTeam(ctx, organizationId, "write")
    const waba = await assertWabaFree(ctx, { organizationId, wabaId })
    const now = Date.now()
    const connectionId = await saveConnection(ctx, args)
    const wabaFields = { connectionId, name: args.wabaName, subscribedAt: now }
    if (waba)
      await ctx.db.patch("whatsappBusinessAccounts", waba._id, wabaFields)
    else
      await ctx.db.insert("whatsappBusinessAccounts", {
        organizationId,
        wabaId,
        ...wabaFields,
      })
    return {
      connectionId,
      accounts: await saveNumbers(ctx, {
        organizationId,
        connectionId,
        wabaId,
        numbers: args.numbers,
      }),
    }
  },
})

/** A connection's credentials and WABAs, for the health check and cleanup. */
export const connectionTarget = internalQuery({
  args: { connectionId: v.id("metaConnections") },
  returns: v.union(
    v.null(),
    v.object({
      status: metaConnectionStatusValue,
      encryptedToken: v.string(),
      wabaIds: v.array(v.string()),
      pages: v.array(
        v.object({
          id: v.id("channelAccounts"),
          pageId: v.string(),
          encryptedToken: v.string(),
        })
      ),
      appId: v.string(),
      graphVersion: v.string(),
      encryptedAppSecret: v.string(),
    })
  ),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get("metaConnections", connectionId)
    const app = await findMetaApp(ctx)
    if (!connection || !app) return null
    const wabas = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
      .take(100)
    return {
      status: connection.status,
      encryptedToken: connection.encryptedToken,
      wabaIds: wabas.map((waba) => waba.wabaId),
      pages: (
        await ctx.db
          .query("channelAccounts")
          .withIndex("by_connectionId", (q) =>
            q.eq("connectionId", connectionId)
          )
          .take(500)
      )
        .filter((a) => a.channel === "messenger" && live(a))
        .map((a) => ({
          id: a._id,
          pageId: a.pageId ?? a.externalId,
          encryptedToken: a.encryptedToken ?? connection.encryptedToken,
        })),
      appId: app.appId,
      graphVersion: app.graphVersion,
      encryptedAppSecret: app.encryptedAppSecret,
    }
  },
})

/** An account a caller who may write acts on, with its connection's token. */
export const accountTarget = internalQuery({
  args: { accountId: v.id("channelAccounts") },
  returns: v.object({
    externalId: v.string(),
    channel: messagingChannelValue,
    pageId: v.optional(v.string()),
    connectionId: v.id("metaConnections"),
    encryptedToken: v.string(),
    graphVersion: v.string(),
  }),
  handler: async (ctx, { accountId }) => {
    const account = await ctx.db.get("channelAccounts", accountId)
    if (!account || !live(account)) throw new ConvexError(NOT_FOUND)
    await requireTeam(ctx, account.organizationId, "write")
    const app = await findMetaApp(ctx)
    if (!app) throw new ConvexError(APP_MISSING)
    const connection = await ctx.db.get("metaConnections", account.connectionId)
    if (connection?.status !== "active")
      throw new ConvexError("Reconnect this business to Meta first")
    return {
      externalId: account.externalId,
      channel: account.channel,
      pageId: account.pageId,
      connectionId: connection._id,
      encryptedToken: account.encryptedToken ?? connection.encryptedToken,
      graphVersion: app.graphVersion,
    }
  },
})

/** Saves a sync of a WABA's numbers, unless the connection no longer
    holds the WABA. */
export const syncNumbers = internalMutation({
  args: {
    connectionId: v.id("metaConnections"),
    wabaId: v.string(),
    numbers: v.array(phoneNumberValue),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, wabaId, numbers }) => {
    const waba = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
      .unique()
    if (waba?.connectionId !== connectionId) return null
    await saveNumbers(ctx, {
      organizationId: waba.organizationId,
      connectionId,
      wabaId,
      numbers,
    })
    return null
  },
})

/** Saves one account's refreshed number, or records its registration. */
export const updateAccount = internalMutation({
  args: {
    accountId: v.id("channelAccounts"),
    number: v.optional(phoneNumberValue),
    registered: v.optional(v.literal(true)),
  },
  returns: v.null(),
  handler: async (ctx, { accountId, number, registered }) => {
    const account = await ctx.db.get("channelAccounts", accountId)
    if (!account || !live(account)) return null
    const now = Date.now()
    if (number && number.externalId === account.externalId)
      await upsertNumber(ctx, {
        organizationId: account.organizationId,
        connectionId: account.connectionId,
        wabaId: account.wabaId ?? "",
        number,
        now,
      })
    if (registered)
      await patchRow(ctx, "channelAccounts", accountId, {
        registeredAt: now,
        ...(account.status === "pending" ? { status: "active" } : {}),
        error: undefined,
      })
    return null
  },
})

/** Records a health check, or a token Meta refused, on the connection. */
export const markConnection = internalMutation({
  args: {
    connectionId: v.id("metaConnections"),
    status: v.union(v.literal("active"), v.literal("error")),
    error: v.optional(v.string()),
    scopes: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, { connectionId, status, error, scopes }) => {
    const connection = await ctx.db.get("metaConnections", connectionId)
    // A disconnected connection stays disconnected.
    if (!connection || connection.status === "disconnected") return null
    await ctx.db.patch("metaConnections", connectionId, {
      status,
      error,
      checkedAt: Date.now(),
      ...(scopes ? { scopes } : {}),
    })
    return null
  },
})

/* ------------------------------------------------------------ disconnect */

/** Disconnects a business: its accounts stop sending and leave the lists,
    its WABAs are freed for any team, and Meta stops sending their webhooks
    (best effort). Messages and conversations stay. */
export const disconnect = mutation({
  args: { connectionId: v.id("metaConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const connection = await ctx.db.get("metaConnections", connectionId)
    if (!connection || connection.status === "disconnected")
      throw new ConvexError("Connection not found")
    await requireTeam(ctx, connection.organizationId, "write")
    const now = Date.now()
    const accounts = await ctx.db
      .query("channelAccounts")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
      .take(500)
    for (const account of accounts)
      if (live(account))
        await patchRow(ctx, "channelAccounts", account._id, {
          status: "disconnected",
          disconnectedAt: now,
        })
    const wabas = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_connectionId", (q) => q.eq("connectionId", connectionId))
      .take(100)
    for (const waba of wabas)
      await ctx.db.delete("whatsappBusinessAccounts", waba._id)
    await ctx.db.patch("metaConnections", connectionId, {
      status: "disconnected",
      error: undefined,
    })
    if (wabas.length)
      await ctx.scheduler.runAfter(
        0,
        internal.meta.connectActions.unsubscribe,
        { connectionId, wabaIds: wabas.map((waba) => waba.wabaId) }
      )
    const pages = accounts.filter(
      (a) => a.channel === "messenger" && a.encryptedToken
    )
    if (pages.length)
      await ctx.scheduler.runAfter(
        0,
        internal.meta.pageConnectActions.unsubscribe,
        {
          pages: pages.map((a) => ({
            pageId: a.pageId ?? a.externalId,
            encryptedToken: a.encryptedToken!,
          })),
        }
      )
    return null
  },
})

/* ----------------------------------------------------------- health cron */

/** The cron's fan-out: one scheduled health check per active connection,
    a page at a time, so no transaction or action walks them all. */
export const dispatchHealthChecks = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("metaConnections")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    for (const connection of page.page)
      await ctx.scheduler.runAfter(
        0,
        internal.meta.connectActions.checkConnection,
        { connectionId: connection._id }
      )
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.meta.connect.dispatchHealthChecks,
        { cursor: page.continueCursor }
      )
    return null
  },
})
