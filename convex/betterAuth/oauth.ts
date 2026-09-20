import { v, ConvexError } from "convex/values"
import { mutation, query } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc } from "./_generated/dataModel"
import schema from "./schema"
import { requireMember, sessionUser } from "./policy"
import { parseScopes, validateCallback } from "../../lib/oauth/policy"

export async function invalidate(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("oauthEpoch")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique()
  if (row) await ctx.db.patch(row._id, { revision: row.revision + 1 })
  else await ctx.db.insert("oauthEpoch", { key, revision: 1 })
}
async function epoch(ctx: QueryCtx | MutationCtx, key: string) {
  return (
    (
      await ctx.db
        .query("oauthEpoch")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique()
    )?.revision ?? 0
  )
}
export async function liveGrant(ctx: QueryCtx | MutationCtx, id: string) {
  const grantId = ctx.db.normalizeId("oauthGrant", id)
  const grant = grantId ? await ctx.db.get(grantId) : null
  if (!grant || grant.revoked) return null
  const userId = ctx.db.normalizeId("user", grant.userId)
  const teamId = ctx.db.normalizeId("organization", grant.organizationId)
  const memberId = ctx.db.normalizeId("member", grant.memberId)
  const user = userId ? await ctx.db.get(userId) : null
  const member = memberId ? await ctx.db.get(memberId) : null
  const client = await ctx.db
    .query("oauthClient")
    .withIndex("clientId", (q) => q.eq("clientId", grant.clientId))
    .unique()
  if (
    !user?.emailVerified ||
    !teamId ||
    !(await ctx.db.get(teamId)) ||
    member?.role !== "owner" ||
    member.userId !== grant.userId ||
    member.organizationId !== grant.organizationId ||
    !client ||
    client.disabled
  )
    return null
  for (const e of grant.epochs)
    if ((await epoch(ctx, e.key)) !== e.revision) return null
  return grant
}
export const invalidateUser = mutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await invalidate(ctx, `user:${userId}`)
    return null
  },
})
export const client = query({
  args: { clientId: v.string() },
  returns: v.union(v.null(), schema.doc("oauthClient")),
  handler: (ctx, { clientId }) =>
    ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", clientId))
      .unique(),
})
export const checkGrant = query({
  args: { id: v.string() },
  returns: v.union(v.null(), schema.doc("oauthGrant")),
  handler: (ctx, { id }) => liveGrant(ctx, id),
})
export const inspectRefresh = query({
  args: { hash: v.string(), clientId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ sub: v.string(), exp: v.number(), scope: v.string() })
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthRefreshToken")
      .withIndex("token", (q) => q.eq("token", args.hash))
      .unique()
    if (
      !row ||
      row.clientId !== args.clientId ||
      row.revoked ||
      row.expiresAt <= Date.now() ||
      !row.referenceId ||
      !(await liveGrant(ctx, row.referenceId))
    )
      return null
    const used = await ctx.db
      .query("oauthUse")
      .withIndex("by_key", (q) => q.eq("key", `refresh:${args.hash}`))
      .unique()
    if (used) return null
    return {
      sub: row.userId,
      exp: Math.floor(row.expiresAt / 1000),
      scope: row.scopes.filter((s) => s !== "offline_access").join(" "),
    }
  },
})
export const rate = mutation({
  args: { key: v.string(), max: v.number(), window: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthRate")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique()
    const now = Date.now()
    if (!row) {
      await ctx.db.insert("oauthRate", { key: args.key, start: now, count: 1 })
      return true
    }
    if (row.start + args.window <= now) {
      await ctx.db.patch(row._id, { start: now, count: 1 })
      return true
    }
    if (row.count >= args.max) return false
    await ctx.db.patch(row._id, { count: row.count + 1 })
    return true
  },
})
export const start = mutation({
  args: { token: v.string(), browserHash: v.string(), query: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const params = new URLSearchParams(args.query)
    const clientId = params.get("client_id") ?? ""
    const client = await ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", clientId))
      .unique()
    const scopes = parseScopes(params.get("scope"))
    if (
      !client ||
      client.disabled ||
      !client.redirectUris.includes(
        validateCallback(params.get("redirect_uri"))
      ) ||
      scopes.some((s) => !client.scopes?.includes(s)) ||
      params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "")
    )
      throw new ConvexError("Invalid authorization request")
    const allowed = [
      "client_id",
      "redirect_uri",
      "scope",
      "state",
      "response_type",
      "code_challenge",
      "code_challenge_method",
    ]
    for (const key of params.keys())
      if (!allowed.includes(key) || params.getAll(key).length !== 1)
        throw new ConvexError("Unsupported authorization parameter")
    await ctx.db.insert("oauthFlow", {
      ...args,
      clientId,
      scopes,
      expiresAt: Date.now() + 600000,
      used: false,
    })
    return null
  },
})
async function flow(
  ctx: QueryCtx | MutationCtx,
  token: string,
  browserHash: string
) {
  const row = await ctx.db
    .query("oauthFlow")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique()
  if (
    !row ||
    row.browserHash !== browserHash ||
    row.expiresAt <= Date.now() ||
    row.used
  )
    throw new ConvexError(
      "Authorization expired or unavailable. Start again from the application."
    )
  return row
}
export const pending = query({
  args: { token: v.string(), browserHash: v.string() },
  returns: v.object({ name: v.string(), scopes: v.array(v.string()) }),
  handler: async (ctx, args) => {
    const f = await flow(ctx, args.token, args.browserHash)
    const c = await ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", f.clientId))
      .unique()
    if (!c || c.disabled) throw new ConvexError("Application unavailable")
    return { name: c.name ?? "Application", scopes: f.scopes }
  },
})
export const decide = mutation({
  args: {
    token: v.string(),
    browserHash: v.string(),
    sessionId: v.string(),
    organizationId: v.string(),
    accept: v.boolean(),
  },
  returns: v.object({
    query: v.string(),
    grantId: v.union(v.null(), v.string()),
  }),
  handler: async (ctx, args) => {
    const f = await flow(ctx, args.token, args.browserHash)
    const { user } = await sessionUser(ctx, args.sessionId)
    if (!args.accept) {
      await ctx.db.patch(f._id, { used: true })
      return { query: f.query, grantId: null }
    }
    const { member } = await requireMember(
      ctx,
      args.sessionId,
      args.organizationId,
      true
    )
    const client = await ctx.db
      .query("oauthClient")
      .withIndex("clientId", (q) => q.eq("clientId", f.clientId))
      .unique()
    if (
      !client ||
      client.disabled ||
      f.scopes.some((s) => !client.scopes?.includes(s))
    )
      throw new ConvexError("Application unavailable")
    const grants = await ctx.db
      .query("oauthGrant")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(100)
    let activeCount = 0
    for (const grant of grants) {
      if (await liveGrant(ctx, grant._id)) activeCount++
      else await ctx.db.delete(grant._id)
    }
    if (activeCount >= 100)
      throw new ConvexError(
        "Disconnect an application before connecting another"
      )
    const teamGrants = await ctx.db
      .query("oauthGrant")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .take(100)
    let teamCount = 0
    for (const grant of teamGrants) {
      if (await liveGrant(ctx, grant._id)) teamCount++
      else await ctx.db.delete(grant._id)
    }
    if (teamCount >= 100)
      throw new ConvexError("This team has reached its 100 application limit")
    const keys = [
      `user:${user._id}`,
      `team:${args.organizationId}`,
      `member:${member._id}`,
      `client:${f.clientId}`,
    ]
    const epochs = []
    for (const key of keys)
      epochs.push({ key, revision: await epoch(ctx, key) })
    const grantId = await ctx.db.insert("oauthGrant", {
      clientId: f.clientId,
      userId: user._id,
      organizationId: args.organizationId,
      memberId: member._id,
      scopes: f.scopes,
      epochs,
      createdAt: Date.now(),
      revoked: false,
    })
    await ctx.db.patch(f._id, { used: true })
    return { query: f.query, grantId }
  },
})
/** Reserve before invoking upstream. The tombstone survives provider cleanup. */
export const claim = mutation({
  args: {
    hash: v.string(),
    kind: v.union(v.literal("code"), v.literal("refresh")),
    clientId: v.string(),
  },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const key = `${args.kind}:${args.hash}`
    const old = await ctx.db
      .query("oauthUse")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
    if (old) {
      const id = ctx.db.normalizeId("oauthGrant", old.grantId)
      const grant = id ? await ctx.db.get(id) : null
      if (grant && grant.clientId === args.clientId)
        await ctx.db.patch(grant._id, { revoked: true })
      return null
    }
    let referenceId: string | undefined
    if (args.kind === "code") {
      const row = await ctx.db
        .query("verification")
        .withIndex("identifier", (q) => q.eq("identifier", args.hash))
        .unique()
      if (!row || row.expiresAt <= Date.now()) return null
      const value = JSON.parse(row.value) as {
        referenceId?: string
        query?: { client_id?: string }
      }
      if (value.query?.client_id !== args.clientId) return null
      referenceId = value.referenceId
    } else {
      const row = await ctx.db
        .query("oauthRefreshToken")
        .withIndex("token", (q) => q.eq("token", args.hash))
        .unique()
      if (
        !row ||
        row.clientId !== args.clientId ||
        row.revoked ||
        row.expiresAt <= Date.now()
      )
        return null
      referenceId = row.referenceId ?? undefined
    }
    if (!referenceId || !(await liveGrant(ctx, referenceId))) return null
    await ctx.db.insert("oauthUse", { key, grantId: referenceId })
    return referenceId
  },
})
export const grantView = v.object({
  id: v.string(),
  application: v.string(),
  team: v.string(),
  organizationId: v.string(),
  scopes: v.array(v.string()),
  createdAt: v.number(),
})
async function view(ctx: QueryCtx | MutationCtx, grant: Doc<"oauthGrant">) {
  const c = await ctx.db
    .query("oauthClient")
    .withIndex("clientId", (q) => q.eq("clientId", grant.clientId))
    .unique()
  const orgId = ctx.db.normalizeId("organization", grant.organizationId)
  return {
    id: grant._id,
    application: c?.name ?? "Application",
    team: (orgId ? await ctx.db.get(orgId) : null)?.name ?? "Team",
    organizationId: grant.organizationId,
    scopes: grant.scopes,
    createdAt: grant.createdAt,
  }
}
export const list = query({
  args: { sessionId: v.string(), organizationId: v.optional(v.string()) },
  returns: v.array(grantView),
  handler: async (ctx, args) => {
    const { user } = await sessionUser(ctx, args.sessionId)
    if (args.organizationId !== undefined)
      await requireMember(ctx, args.sessionId, args.organizationId, true)
    const rows =
      args.organizationId !== undefined
        ? await ctx.db
            .query("oauthGrant")
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId!)
            )
            .take(100)
        : await ctx.db
            .query("oauthGrant")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
            .take(100)
    const result = []
    for (const row of rows)
      if (await liveGrant(ctx, row._id)) result.push(await view(ctx, row))
    return result
  },
})
export const disconnect = mutation({
  args: {
    sessionId: v.string(),
    id: v.id("oauthGrant"),
    organizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await sessionUser(ctx, args.sessionId)
    const grant = await ctx.db.get(args.id)
    if (args.organizationId !== undefined) {
      await requireMember(ctx, args.sessionId, args.organizationId, true)
      if (!grant || grant.organizationId !== args.organizationId)
        throw new ConvexError("Authorization not found")
    } else if (!grant || grant.userId !== user._id)
      throw new ConvexError("Authorization not found")
    await ctx.db.patch(grant._id, { revoked: true })
    return null
  },
})
/** Resource authorization is rechecked inside the transaction that reads/writes data. */
export const resource = mutation({
  args: {
    grantId: v.string(),
    scopes: v.array(v.string()),
    revokeId: v.optional(v.string()),
  },
  returns: v.array(grantView),
  handler: async (ctx, args) => {
    const grant = await liveGrant(ctx, args.grantId)
    if (
      !grant ||
      !args.scopes.includes("full_access") ||
      !grant.scopes.includes("full_access") ||
      args.scopes.some((s) => !grant.scopes.includes(s))
    )
      throw new ConvexError("Insufficient permission")
    if (args.revokeId) {
      const id = ctx.db.normalizeId("oauthGrant", args.revokeId)
      const target = id ? await ctx.db.get(id) : null
      if (!target || target.organizationId !== grant.organizationId)
        throw new ConvexError("Authorization not found")
      await ctx.db.patch(target._id, { revoked: true })
      return []
    }
    const rows = await ctx.db
      .query("oauthGrant")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", grant.organizationId)
      )
      .take(100)
    const result = []
    for (const row of rows)
      if (await liveGrant(ctx, row._id)) result.push(await view(ctx, row))
    return result
  },
})
export const revokeToken = mutation({
  args: { hash: v.string(), clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = await ctx.db
      .query("oauthRefreshToken")
      .withIndex("token", (q) => q.eq("token", args.hash))
      .unique()
    if (token?.clientId === args.clientId && token.referenceId) {
      const id = ctx.db.normalizeId("oauthGrant", token.referenceId)
      if (id && (await ctx.db.get(id)))
        await ctx.db.patch(id, { revoked: true })
    }
    return null
  },
})
export const revokeGrant = mutation({
  args: { id: v.string(), clientId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const id = ctx.db.normalizeId("oauthGrant", args.id)
    const grant = id ? await ctx.db.get(id) : null
    if (grant?.clientId === args.clientId)
      await ctx.db.patch(grant._id, { revoked: true })
    return null
  },
})
