import { v } from "convex/values"
import {
  internalMutation,
  internalQuery,
  query,
  action,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import { actor, authorizeToolkit, ownedToolkit } from "../botToolkitAccess"
import { invalid, type Caller } from "../api/caller"
import { encryptSecret } from "../secrets"
import { idempotent } from "../api/idempotency"
import { listArgs, cursorPage } from "../api/paging"
import { stream } from "convex-helpers/server/stream"
import schema from "../schema"
import {
  record,
  text,
  stringList,
  validateToolSchema,
} from "../../lib/bot-toolkit"
import { VOICE_BOT_TOOLS } from "../../lib/voice-bots"
import { isPublicHostname } from "../../lib/net/public-host"
export function publicTool(row: Doc<"botTools">) {
  return {
    id: row._id,
    name: row.name,
    description: row.description,
    parameters: JSON.parse(row.parameters),
    method: row.method,
    url: row.url,
    timeoutMs: row.timeoutMs,
    resultFields: row.resultFields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
async function listTools(
  ctx: QueryCtx,
  args: {
    organizationId: string
    caller?: Caller
    limit: number
    after?: string
    before?: string
  }
) {
  await authorizeToolkit(ctx, args, "bot_tools")
  if (
    !Number.isInteger(args.limit) ||
    args.limit < 1 ||
    args.limit > 100 ||
    (args.after && args.before)
  )
    throw invalid("Use limit 1–100 and one cursor")
  const page = await cursorPage(
    args,
    async (id) => {
      const normalized = ctx.db.normalizeId("botTools", id),
        row = normalized ? await ctx.db.get("botTools", normalized) : null
      return row?.organizationId === args.organizationId ? row : null
    },
    (order) =>
      stream(ctx.db, schema)
        .query("botTools")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .order(order)
  )
  return {
    object: "list",
    has_more: page.has_more,
    data: page.data.map(publicTool),
  }
}
export const list = internalQuery({
  args: { ...actor, ...listArgs },
  returns: v.any(),
  handler: listTools,
})
export const dashboardList = query({
  args: { organizationId: v.string(), ...listArgs },
  returns: v.any(),
  handler: listTools,
})
export const get = internalQuery({
  args: { ...actor, id: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "bot_tools")
    return publicTool(
      await ownedToolkit(ctx, "botTools", args.organizationId, args.id)
    )
  },
})
export const authorized = internalQuery({
  args: { ...actor, id: v.string() },
  returns: schema.doc("botTools"),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "bot_tools", true)
    return ownedToolkit(ctx, "botTools", args.organizationId, args.id)
  },
})
export const save = internalMutation({
  args: {
    ...actor,
    id: v.optional(v.string()),
    input: v.record(v.string(), v.any()),
  },
  returns: v.object({ id: v.id("botTools") }),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "bot_tools", true)
    const write = async () => {
      const previous = args.id
        ? await ownedToolkit(ctx, "botTools", args.organizationId, args.id)
        : null
      if (
        Object.keys(args.input).some(
          (k) =>
            ![
              "name",
              "description",
              "parameters",
              "method",
              "url",
              "headers",
              "signingSecret",
              "timeoutMs",
              "resultFields",
            ].includes(k)
        )
      )
        throw invalid("Unknown tool field")
      const input = { ...(previous ? publicTool(previous) : {}), ...args.input }
      const name = text(input.name, "Name", 64)
      if (
        !/^[a-z][a-z0-9_]{0,63}$/.test(name) ||
        Object.hasOwn(VOICE_BOT_TOOLS, name) ||
        ["search_knowledge", "save_field"].includes(name)
      )
        throw invalid(
          "Choose a unique snake_case tool name; built-in names are reserved"
        )
      const existing = await ctx.db
        .query("botTools")
        .withIndex("by_organizationId_and_name", (q) =>
          q.eq("organizationId", args.organizationId).eq("name", name)
        )
        .unique()
      if (existing && existing._id !== previous?._id)
        throw invalid("This tool name is already used")
      const description = text(input.description, "Description", 2000),
        parameters = validateToolSchema(input.parameters),
        url = text(input.url, "URL", 2048),
        parsed = new URL(url)
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        !isPublicHostname(parsed.hostname)
      )
        throw invalid("Use a public HTTPS endpoint")
      const method = input.method ?? "POST"
      if (
        method !== "GET" &&
        method !== "POST" &&
        method !== "PUT" &&
        method !== "PATCH" &&
        method !== "DELETE"
      )
        throw invalid("Unsupported HTTP method")
      const timeoutMs = input.timeoutMs ?? 10000
      if (
        typeof timeoutMs !== "number" ||
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 100 ||
        timeoutMs > 10000
      )
        throw invalid("Timeout must be between 100 and 10,000 milliseconds")
      const resultFields =
        input.resultFields === undefined
          ? undefined
          : stringList(input.resultFields, 32)
      let encryptedHeaders = previous?.encryptedHeaders
      if (args.input.headers !== undefined || !previous) {
        const headers = record(args.input.headers ?? {})
        if (Object.keys(headers).length > 16)
          throw invalid("Use up to 16 headers")
        for (const [key, value] of Object.entries(headers))
          if (
            !/^[A-Za-z0-9-]{1,64}$/.test(key) ||
            /^(host|content-length|connection|transfer-encoding|webhook-.+|svix-.+|accept-encoding)$/i.test(
              key
            ) ||
            typeof value !== "string" ||
            value.length > 4096 ||
            /[\r\n\0]/.test(value)
          )
            throw invalid("Invalid or reserved request header")
        encryptedHeaders = await encryptSecret(JSON.stringify(headers))
      }
      let encryptedSigningSecret = previous?.encryptedSigningSecret
      if (args.input.signingSecret !== undefined || !previous) {
        const secret =
          args.input.signingSecret ?? crypto.randomUUID() + crypto.randomUUID()
        if (
          typeof secret !== "string" ||
          secret.length < 32 ||
          secret.length > 256
        )
          throw invalid("Signing secret must contain 32–256 characters")
        encryptedSigningSecret = await encryptSecret(secret)
      }
      const now = Date.now(),
        fields = {
          name,
          description,
          parameters: JSON.stringify(parameters),
          method,
          url,
          encryptedHeaders: encryptedHeaders!,
          encryptedSigningSecret: encryptedSigningSecret!,
          timeoutMs,
          resultFields,
          updatedAt: now,
        }
      if (previous) {
        await ctx.db.patch("botTools", previous._id, fields)
        return previous._id
      }
      return ctx.db.insert("botTools", {
        ...fields,
        organizationId: args.organizationId,
        createdAt: now,
      })
    }
    try {
      return {
        id: args.caller
          ? await idempotent(ctx, args.caller, write, (id) => ({
              body: { id },
            }))
          : await write(),
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "ConvexError")
        throw invalid(error.message)
      throw error
    }
  },
})
export const remove = internalMutation({
  args: { ...actor, id: v.string() },
  returns: v.object({ id: v.string(), deleted: v.boolean() }),
  handler: async (ctx, args) => {
    await authorizeToolkit(ctx, args, "bot_tools", true)
    const row = await ownedToolkit(
      ctx,
      "botTools",
      args.organizationId,
      args.id
    )
    await ctx.db.delete("botTools", row._id)
    await ctx.scheduler.runAfter(0, internal.botToolkitAccess.detach, {
      organizationId: args.organizationId,
      kind: "tool",
      id: row._id,
    })
    return { id: args.id, deleted: true }
  },
})
export const dashboardWrite = action({
  args: {
    organizationId: v.string(),
    id: v.optional(v.string()),
    remove: v.optional(v.boolean()),
    body: v.string(),
  },
  returns: v.any(),
  handler: (ctx, args): Promise<{ id: string; deleted?: boolean }> =>
    args.remove
      ? ctx.runMutation(internal.botTools.resources.remove, {
          organizationId: args.organizationId,
          id: args.id!,
        })
      : ctx.runMutation(internal.botTools.resources.save, {
          organizationId: args.organizationId,
          id: args.id,
          input: JSON.parse(args.body),
        }),
})
