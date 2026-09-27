import { ConvexError, v, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from "convex/server"
import {
  action,
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { components, internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { requireTeam, sessionId } from "./access"
import schema from "./schema"
import { apiKeyPermissionValue } from "./tables/api"
import { createToken, tokenParts } from "../lib/dashboard/ids"
import { tokenHash } from "../lib/oauth/policy"

/** `lastUsedAt` is written at most this often per key. */
const USAGE_INTERVAL = 60_000
/** "Total uses" counts retained requests up to this many. */
const REQUEST_COUNT_CAP = 1000

export const keyInput = v.object({
  name: v.string(),
  permission: apiKeyPermissionValue,
  /** Sending access only; any other value is ignored for full access. */
  domainId: v.optional(v.union(v.null(), v.string())),
})
type KeyInput = Infer<typeof keyInput>

/** A key as the dashboard sees it: never the token hash. */
export const keyView = schema
  .doc("apiKeys")
  .omit("tokenHash", "search")
  .extend({ lastUsedAt: v.union(v.null(), v.number()) })

async function lastUsed(ctx: QueryCtx, id: Id<"apiKeys">) {
  const usage = await ctx.db
    .query("apiKeyUsage")
    .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", id))
    .unique()
  return usage?.lastUsedAt ?? null
}
export async function viewKey(ctx: QueryCtx, key: Doc<"apiKeys">) {
  const { tokenHash: _hash, search: _search, ...rest } = key
  return { ...rest, lastUsedAt: await lastUsed(ctx, key._id) }
}

/** Checks a name, permission and domain, and settles the domain: only a
    sending key keeps one, and it must be a live domain of the same team. */
async function settle(
  ctx: MutationCtx,
  organizationId: string,
  input: KeyInput,
  /** The key's current domain, kept even once removed ("sending disabled"). */
  current?: Id<"domains">
) {
  const name = input.name.trim()
  if (!name) throw new ConvexError("Enter a name")
  if (name.length > 50)
    throw new ConvexError("The name must be at most 50 characters")
  if (input.permission !== "sending_access" || !input.domainId)
    return { name, permission: input.permission, domainId: undefined }
  if (input.domainId === current)
    return { name, permission: input.permission, domainId: current }
  const id = ctx.db.normalizeId("domains", input.domainId)
  const domain = id ? await ctx.db.get("domains", id) : null
  if (!domain || domain.deleted || domain.organizationId !== organizationId)
    throw new ConvexError("Domain not found")
  return { name, permission: input.permission, domainId: domain._id }
}

/** A new key's token, made where randomness is real (an action). */
export async function mintToken() {
  const token = createToken()
  const { prefix, last4 } = tokenParts(token)
  return {
    token,
    tokenHash: await tokenHash(token),
    tokenPrefix: prefix,
    tokenLast4: last4,
  }
}
export const mintedValue = v.object({
  tokenHash: v.string(),
  tokenPrefix: v.string(),
  tokenLast4: v.string(),
})

export async function insertKey(
  ctx: MutationCtx,
  organizationId: string,
  input: KeyInput,
  minted: Infer<typeof mintedValue>,
  createdBy: Doc<"apiKeys">["createdBy"]
) {
  const settled = await settle(ctx, organizationId, input)
  return ctx.db.insert("apiKeys", {
    organizationId,
    ...settled,
    ...minted,
    createdBy,
    search: `${settled.name} ${minted.tokenPrefix}`,
  })
}
export async function patchKey(
  ctx: MutationCtx,
  key: Doc<"apiKeys">,
  patch: Partial<KeyInput>
) {
  const next = await settle(
    ctx,
    key.organizationId,
    {
      name: patch.name ?? key.name,
      permission: patch.permission ?? key.permission,
      domainId: patch.domainId === undefined ? key.domainId : patch.domainId,
    },
    key.domainId
  )
  await ctx.db.patch("apiKeys", key._id, {
    ...next,
    search: `${next.name} ${key.tokenPrefix}`,
  })
}
export async function deleteKey(ctx: MutationCtx, key: Doc<"apiKeys">) {
  const usage = await ctx.db
    .query("apiKeyUsage")
    .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", key._id))
    .unique()
  if (usage) await ctx.db.delete("apiKeyUsage", usage._id)
  await ctx.db.delete("apiKeys", key._id)
}
/** A deleted team's keys stop working with it. */
export async function retireApiKeys(ctx: MutationCtx, organizationId: string) {
  for await (const key of ctx.db
    .query("apiKeys")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    ))
    await deleteKey(ctx, key)
}
/** Stamps `lastUsedAt`, at most once a minute so busy keys do not contend. */
export async function touchKey(ctx: MutationCtx, id: Id<"apiKeys">) {
  const now = Date.now()
  const usage = await ctx.db
    .query("apiKeyUsage")
    .withIndex("by_apiKeyId", (q) => q.eq("apiKeyId", id))
    .unique()
  if (!usage)
    await ctx.db.insert("apiKeyUsage", { apiKeyId: id, lastUsedAt: now })
  else if (now - usage.lastUsedAt >= USAGE_INTERVAL)
    await ctx.db.patch("apiKeyUsage", usage._id, { lastUsedAt: now })
}

export const keyFilters = v.object({
  permission: v.optional(apiKeyPermissionValue),
  /** Matches the name and the visible token prefix. */
  search: v.optional(v.string()),
})
/** Newest first, or best match first for a search. */
export async function keyPage(
  ctx: QueryCtx,
  args: Infer<typeof keyFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const search = args.search?.trim().slice(0, 100)
  const keys = ctx.db.query("apiKeys")
  const rows = search
    ? keys.withSearchIndex("search_keys", (q) => {
        const s = q.search("search", search).eq("organizationId", org)
        return args.permission ? s.eq("permission", args.permission) : s
      })
    : args.permission
      ? keys
          .withIndex("by_organizationId_and_permission", (q) =>
            q.eq("organizationId", org).eq("permission", args.permission!)
          )
          .order("desc")
      : keys
          .withIndex("by_organizationId", (q) => q.eq("organizationId", org))
          .order("desc")
  const result = await rows.paginate(args.paginationOpts)
  return {
    ...result,
    page: await Promise.all(result.page.map((key) => viewKey(ctx, key))),
  }
}
export const list = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
    ...keyFilters.fields,
  },
  returns: paginationResultValidator(keyView),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    return keyPage(ctx, args)
  },
})
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      key: keyView,
      /** Requests still in the logs, counted up to a cap. */
      requests: v.number(),
      moreRequests: v.boolean(),
    })
  ),
  handler: async (ctx, { id }) => {
    const keyId = ctx.db.normalizeId("apiKeys", id)
    const key = keyId ? await ctx.db.get("apiKeys", keyId) : null
    if (!key) return null
    await requireTeam(ctx, key.organizationId)
    const logs = await ctx.db
      .query("apiLogs")
      .withIndex("by_organizationId_and_apiKeyId", (q) =>
        q.eq("organizationId", key.organizationId).eq("apiKeyId", key._id)
      )
      .take(REQUEST_COUNT_CAP + 1)
    return {
      key: await viewKey(ctx, key),
      requests: Math.min(logs.length, REQUEST_COUNT_CAP),
      moreRequests: logs.length > REQUEST_COUNT_CAP,
    }
  },
})

/** The dashboard's create: the token is minted here, returned once, and
    only its hash is stored. */
export const create = action({
  args: { organizationId: v.string(), input: keyInput },
  returns: v.object({ id: v.id("apiKeys"), token: v.string() }),
  handler: async (ctx, args): Promise<{ id: Id<"apiKeys">; token: string }> => {
    const { token, ...minted } = await mintToken()
    const id: Id<"apiKeys"> = await ctx.runMutation(internal.apiKeys.insert, {
      ...args,
      minted,
    })
    return { id, token }
  },
})
export const insert = internalMutation({
  args: {
    organizationId: v.string(),
    input: keyInput,
    minted: mintedValue,
  },
  returns: v.id("apiKeys"),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId, "write")
    const user = await ctx.runQuery(components.betterAuth.policy.checkSession, {
      sessionId: await sessionId(ctx),
    })
    return insertKey(ctx, args.organizationId, args.input, args.minted, {
      userId: user.userId,
      name: user.name,
    })
  },
})
export const update = mutation({
  args: { id: v.id("apiKeys"), patch: keyInput.partial() },
  returns: v.null(),
  handler: async (ctx, { id, patch }) => {
    const key = await ctx.db.get("apiKeys", id)
    if (!key) throw new ConvexError("API key not found")
    await requireTeam(ctx, key.organizationId, "write")
    await patchKey(ctx, key, patch)
    return null
  },
})
export const remove = mutation({
  args: { id: v.id("apiKeys") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const key = await ctx.db.get("apiKeys", id)
    if (!key) throw new ConvexError("API key not found")
    await requireTeam(ctx, key.organizationId, "write")
    await deleteKey(ctx, key)
    return null
  },
})
