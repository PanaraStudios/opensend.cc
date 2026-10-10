import { stream } from "convex-helpers/server/stream"
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
import {
  countValue,
  counters,
  deleteRow,
  insertRow,
  literals,
  patchRow,
} from "./counts"
import { filteredPage, matchesSearch, readTeamRow, hasTeamRows } from "./lists"
import { logCount } from "./logs"
import { createToken, tokenParts } from "../lib/dashboard/ids"
import { parseScopes, scopeAllows } from "../lib/api-scopes"
import { tokenHash } from "../lib/oauth/policy"

/** `lastUsedAt` is written at most this often per key. */
const USAGE_INTERVAL = 60_000

export const keyInput = v.object({
  name: v.string(),
  permission: apiKeyPermissionValue,
  scopes: v.optional(v.array(v.string())),
  /** Sending access or custom emails:write; ignored otherwise. */
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
  // Explicit, so the token hash and search text never leave the server.
  return {
    _id: key._id,
    _creationTime: key._creationTime,
    organizationId: key.organizationId,
    name: key.name,
    tokenPrefix: key.tokenPrefix,
    tokenLast4: key.tokenLast4,
    permission: key.permission,
    scopes: key.scopes,
    domainId: key.domainId,
    createdBy: key.createdBy,
    lastUsedAt: await lastUsed(ctx, key._id),
  }
}

/** Validate scopes and keep a domain only for sending access or custom
    email writes. A new restriction must belong to a live domain of the team. */
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
  let scopes: string[] | undefined
  try {
    if (input.scopes !== undefined || input.permission === "custom")
      scopes = parseScopes(input.scopes)
  } catch (error) {
    throw new ConvexError(
      error instanceof Error ? error.message : "Invalid scopes"
    )
  }
  if (input.permission !== "custom") scopes = undefined
  if (input.permission === "custom" && !scopes?.length)
    throw new ConvexError(
      "Choose at least one resource scope for a Custom API key"
    )
  const settled = { name, permission: input.permission, scopes }
  const domainAllowed =
    input.permission === "sending_access" ||
    (input.permission === "custom" &&
      scopeAllows(scopes ?? [], "emails", "write"))
  if (!domainAllowed || !input.domainId)
    return { ...settled, domainId: undefined }
  if (input.domainId === current) return { ...settled, domainId: current }
  const id = ctx.db.normalizeId("domains", input.domainId)
  const domain = id ? await ctx.db.get("domains", id) : null
  if (!domain || domain.deleted || domain.organizationId !== organizationId)
    throw new ConvexError("Domain not found")
  return { ...settled, domainId: domain._id }
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
  return insertRow(ctx, "apiKeys", {
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
      scopes: patch.scopes ?? key.scopes,
      domainId: patch.domainId === undefined ? key.domainId : patch.domainId,
    },
    key.domainId
  )
  await patchRow(ctx, "apiKeys", key._id, {
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
  await deleteRow(ctx, "apiKeys", key._id)
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
// 512 keys + at most 512 tiny usage rows; well below 32k documents / 4096 ranges.
export const KEY_SEARCH_BUDGET = {
  rows: 512,
  bytes: 4 * 1024 * 1024,
  bytesPerMatch: 1024,
}

/** Newest first; substring search filters each bounded index page. */
export async function keyPage(
  ctx: QueryCtx,
  args: Infer<typeof keyFilters> & {
    organizationId: string
    paginationOpts: PaginationOptions
  }
) {
  const org = args.organizationId
  const search = args.search
  const keys = stream(ctx.db, schema).query("apiKeys")
  const rows = args.permission
    ? keys
        .withIndex("by_organizationId_and_permission", (q) =>
          q.eq("organizationId", org).eq("permission", args.permission!)
        )
        .order("desc")
    : keys
        .withIndex("by_organizationId", (q) => q.eq("organizationId", org))
        .order("desc")
  const matches = matchesSearch(search)
  const result = await filteredPage(
    rows,
    args.paginationOpts,
    (key) => matches(key.name, key.tokenPrefix),
    KEY_SEARCH_BUDGET,
    search
  )
  return {
    ...result,
    page: await Promise.all(result.page.map((key) => viewKey(ctx, key))),
  }
}
export const count = query({
  args: { organizationId: v.string(), ...keyFilters.fields },
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    if (args.search?.trim()) return { total: null }
    return {
      total: await counters.apiKeys.total(ctx, args.organizationId, [
        { is: args.permission, among: literals(apiKeyPermissionValue) },
      ]),
    }
  },
})
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
/** Whether the team has any key at all, whatever the list's filters: the
    list says "No API keys" only when it has none. */
export const hasAny = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { organizationId }) =>
    hasTeamRows(ctx, "apiKeys", organizationId),
})
export const get = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      key: keyView,
      /** Requests still in the logs. */
      requests: v.number(),
    })
  ),
  handler: async (ctx, { id }) => {
    const key = await readTeamRow(ctx, "apiKeys", id)
    if (!key) return null
    return {
      key: await viewKey(ctx, key),
      requests:
        (await logCount(ctx, {
          organizationId: key.organizationId,
          apiKeyId: key._id,
        })) ?? 0,
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
