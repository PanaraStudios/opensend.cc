import { idempotent } from "./idempotency"
import { v } from "convex/values"
import type { HttpRouter } from "convex/server"
import { toPlainText } from "@react-email/render"
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import schema from "../schema"
import {
  aliasOwner,
  duplicateTemplate,
  findDraft,
  findPublished,
  insertTemplate,
  publishTemplate,
  removeTemplate,
  resolvedVariables,
  updateTemplate,
  type Input,
} from "../templates"
import { apiError, callerValue, notFound, requireCaller } from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  stringField,
} from "./route"
import type { Doc } from "../_generated/dataModel"

async function own(ctx: QueryCtx, organizationId: string, value: string) {
  const id = ctx.db.normalizeId("templates", value)
  const row = id
    ? await ctx.db.get("templates", id)
    : await aliasOwner(ctx, organizationId, value)
  if (!row || row.organizationId !== organizationId) throw notFound("Template")
  return row
}
const invalid = (message: string) => apiError(422, "validation_error", message)
function inputFields(body: string, required = false): Input {
  const input = objectBody(JSON.parse(body))
  const reply = input.reply_to
  let replyToAddresses: string[] | undefined
  if (reply !== undefined) {
    if (typeof reply === "string") replyToAddresses = reply ? [reply] : []
    else if (
      Array.isArray(reply) &&
      reply.every((address): address is string => typeof address === "string")
    )
      replyToAddresses = reply
    else throw invalid("Invalid `reply_to` field.")
  }
  let variableDefinitions: Input["variableDefinitions"]
  if (input.variables !== undefined) {
    if (!Array.isArray(input.variables) || input.variables.length > 50)
      throw invalid("A template can use at most 50 variables.")
    variableDefinitions = input.variables.map((value) => {
      const variable = objectBody(value)
      const key = stringField(variable, "key", true)!
      const type = enumField(variable, "type", ["string", "number"])
      if (!type) throw invalid("Missing variable type.")
      const fallback = variable.fallback_value
      if (
        fallback !== undefined &&
        (typeof fallback !== type ||
          (typeof fallback === "number" && !Number.isFinite(fallback)))
      )
        throw invalid("The variable fallback must match its type.")
      return {
        key,
        type,
        ...(fallback === undefined ? {} : { fallback: String(fallback) }),
      }
    })
  }
  return {
    name: stringField(input, "name", required),
    html: stringField(input, "html", required),
    ...(input.html !== undefined ? { content: null } : {}),
    alias: stringField(input, "alias"),
    subject: stringField(input, "subject"),
    from: stringField(input, "from"),
    text: stringField(input, "text"),
    ...(replyToAddresses === undefined
      ? {}
      : { replyToAddresses, replyTo: replyToAddresses[0] ?? "" }),
    ...(variableDefinitions === undefined ? {} : { variableDefinitions }),
  }
}
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("templates")),
  }),
  handler: async (ctx, { caller, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      async (value) => {
        try {
          return (await own(ctx, caller.organizationId, value))._creationTime
        } catch {
          return null
        }
      },
      (bound, order, count) =>
        ctx.db
          .query("templates")
          .withIndex("by_organizationId", (q) => {
            const scope = q.eq("organizationId", caller.organizationId)
            return bound.lt !== undefined
              ? scope.lt("_creationTime", bound.lt)
              : bound.gt !== undefined
                ? scope.gt("_creationTime", bound.gt)
                : scope
          })
          .order(order)
          .take(count)
    )
  },
})
export const get = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.object({
    row: schema.doc("templates"),
    draft: v.union(schema.doc("templateDrafts"), v.null()),
    published: v.union(schema.doc("publishedTemplates"), v.null()),
  }),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    return {
      row,
      draft: await findDraft(ctx, row._id),
      published: await findPublished(ctx, row._id),
    }
  },
})
export const create = internalMutation({
  args: { caller: callerValue, body: v.string() },
  returns: v.id("templates"),
  handler: async (ctx, { caller, body }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const input = inputFields(body, true)
        const id = await insertTemplate(ctx, caller.organizationId, {
          ...input,
          name: input.name!,
          html: input.html!,
          subject: input.subject ?? "",
          preview: "",
        })
        if (input.alias !== undefined)
          await updateTemplate(ctx, (await ctx.db.get("templates", id))!, {
            alias: input.alias,
          })
        return id
      },
      (id) => ({ body: { object: "template", id } })
    )
  },
})
export const change = internalMutation({
  args: {
    caller: callerValue,
    id: v.string(),
    kind: v.union(
      v.literal("update"),
      v.literal("remove"),
      v.literal("publish"),
      v.literal("duplicate")
    ),
    body: v.string(),
  },
  returns: v.id("templates"),
  handler: async (ctx, { caller, id, kind, body }) => {
    return idempotent(
      ctx,
      caller,
      async () => {
        await requireCaller(ctx, caller)
        const row = await own(ctx, caller.organizationId, id)
        if (kind === "update") await updateTemplate(ctx, row, inputFields(body))
        if (kind === "remove") await removeTemplate(ctx, row)
        if (kind === "publish") await publishTemplate(ctx, row)
        if (kind === "duplicate") return duplicateTemplate(ctx, row)
        return row._id
      },
      (id) => ({ body: { object: "template", id } })
    )
  },
})
function summary(row: Doc<"templates">) {
  return {
    id: row._id,
    name: row.name,
    alias: row.alias,
    status: row.status,
    created_at: apiTime(row._creationTime),
    updated_at: apiTime(row.updatedAt),
    published_at:
      row.status === "published" && row.publishedAt
        ? apiTime(row.publishedAt)
        : null,
  }
}
export function registerTemplateRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/templates",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const result = await ctx.runQuery(internal.api.templates.list, {
        caller,
        ...listParams(query),
      })
      return {
        body: {
          object: "list",
          has_more: result.has_more,
          data: result.data.map(summary),
        },
      }
    },
  })
  apiRoute(http, {
    method: "GET",
    path: "/templates/{id}",
    permission: "full_access",
    handler: async (ctx, { caller, params }) => {
      const { row, draft, published } = await ctx.runQuery(
        internal.api.templates.get,
        { caller, id: params.id }
      )
      return {
        body: {
          object: "template",
          ...summary(row),
          current_version_id: draft?._id ?? null,
          from: row.from ?? null,
          subject: row.subject,
          reply_to: row.replyToAddresses ?? row.replyTo ?? null,
          html: draft?.html ?? "",
          text: draft?.text ?? toPlainText(draft?.html ?? ""),
          variables: resolvedVariables(row, draft ?? { html: "" }).map(
            (variable) => ({
              key: variable.key,
              type: variable.type ?? "string",
              fallback_value:
                variable.fallback === undefined
                  ? null
                  : variable.type === "number"
                    ? Number(variable.fallback)
                    : variable.fallback,
            })
          ),
          has_unpublished_versions:
            !published || row.updatedAt > (row.publishedAt ?? 0),
        },
      }
    },
  })
  apiRoute(http, {
    method: "POST",
    path: "/templates",
    permission: "full_access",
    handler: async (ctx, { caller, body }) => ({
      body: {
        object: "template",
        id: await ctx.runMutation(internal.api.templates.create, {
          caller,
          body: JSON.stringify(body ?? {}),
        }),
      },
    }),
  })
  for (const kind of ["update", "remove", "publish", "duplicate"] as const)
    apiRoute(http, {
      method:
        kind === "update" ? "PATCH" : kind === "remove" ? "DELETE" : "POST",
      path: `/templates/{id}${kind === "publish" || kind === "duplicate" ? `/${kind}` : ""}`,
      permission: "full_access",
      handler: async (ctx, { caller, params, body }) => ({
        body: {
          object: "template",
          id: await ctx.runMutation(internal.api.templates.change, {
            caller,
            id: params.id,
            kind,
            body: JSON.stringify(body ?? {}),
          }),
          ...(kind === "remove" ? { deleted: true } : {}),
        },
      }),
    })
}
