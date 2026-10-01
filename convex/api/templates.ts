import { parseTemplateInput, type TemplateChannel } from "../templateChannels"
import { rowChannel } from "../../lib/meta/templates"
import { localTemplate } from "../../lib/meta/local-templates"
import { stream } from "convex-helpers/server/stream"
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
  insertWhatsAppTemplate,
  publishTemplate,
  removeTemplate,
  resolvedVariables,
  updateTemplate,
} from "../templates"
import { channelValue } from "../tables/channels"
import { storedComponents, whatsappSettings } from "../whatsapp/rows"
import { callerValue, requireCaller, invalid, requireTeamRow } from "./caller"
import { cursorPage, listArgs } from "./paging"
import { listBody, apiRoute, apiTime, listParams } from "./route"
import type { Doc } from "../_generated/dataModel"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(ctx, "templates", organizationId, value, "Template", {
    fallback: () => aliasOwner(ctx, organizationId, value),
  })
}
export const list = internalQuery({
  args: { caller: callerValue, ...listArgs, channel: v.optional(channelValue) },
  returns: v.object({
    has_more: v.boolean(),
    data: v.array(schema.doc("templates")),
  }),
  handler: async (ctx, { caller, channel, ...page }) => {
    await requireCaller(ctx, caller)
    return cursorPage(
      page,
      async (value) => {
        try {
          return await own(ctx, caller.organizationId, value)
        } catch {
          return null
        }
      },
      (order) =>
        stream(ctx.db, schema)
          .query("templates")
          .withIndex("by_organizationId", (q) => {
            return q.eq("organizationId", caller.organizationId)
          })
          .order(order)
          .filterWith(async (row) => !channel || rowChannel(row) === channel)
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
        const input = parseTemplateInput(body, true)
        if (input.channel === "whatsapp") {
          // A CRM names its template; a taken name is refused, not renumbered.
          const id = await insertWhatsAppTemplate(ctx, caller.organizationId, {
            name: input.name!,
            content: input.content,
            whatsapp: await whatsappSettings(
              ctx,
              caller.organizationId,
              input.whatsapp ?? {}
            ),
          })
          if (input.alias !== undefined)
            await updateTemplate(ctx, (await ctx.db.get("templates", id))!, {
              alias: input.alias,
            })
          return id
        }
        const id = await insertTemplate(ctx, caller.organizationId, {
          ...input,
          name: input.name!,
          html: input.html ?? "",
          subject: input.subject ?? "",
          preview: "",
        })
        if (input.alias !== undefined)
          await updateTemplate(ctx, (await ctx.db.get("templates", id))!, {
            alias: input.alias,
          })
        return id
      },
      (id) => ({ status: 201, body: { object: "template", id } })
    )
  },
})
/** A template's id and channel: WhatsApp publishes and deletes go to Meta. */
export const target = internalQuery({
  args: { caller: callerValue, id: v.string() },
  returns: v.object({ id: v.id("templates"), channel: channelValue }),
  handler: async (ctx, { caller, id }) => {
    await requireCaller(ctx, caller)
    const row = await own(ctx, caller.organizationId, id)
    return { id: row._id, channel: rowChannel(row) }
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
        if (kind === "update")
          await updateTemplate(
            ctx,
            row,
            parseTemplateInput(body, false, rowChannel(row))
          )
        if (kind === "remove") await removeTemplate(ctx, row)
        if (kind === "publish") await publishTemplate(ctx, row)
        if (kind === "duplicate") return duplicateTemplate(ctx, row)
        return row._id
      },
      (id) => ({ body: { object: "template", id } })
    )
  },
})
/** A WhatsApp template's Meta side; email templates have none, and their
    responses keep Resend's shape exactly. */
function whatsappSummary(row: Doc<"templates">) {
  const whatsapp = row.whatsapp
  if (row.channel !== "whatsapp" || !whatsapp) return {}
  return {
    channel: "whatsapp" as const,
    whatsapp: {
      waba_id: whatsapp.wabaId,
      language: whatsapp.language,
      category: whatsapp.category,
      parameter_format: whatsapp.parameterFormat,
      meta_template_id: whatsapp.metaTemplateId ?? null,
      status: whatsapp.metaStatus ?? null,
      rejected_reason: whatsapp.rejectedReason ?? null,
      quality: whatsapp.quality ?? null,
      submitted_at: whatsapp.submittedAt ? apiTime(whatsapp.submittedAt) : null,
      synced_at: whatsapp.syncedAt ? apiTime(whatsapp.syncedAt) : null,
    },
  }
}
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
    ...(row.channel === "messenger" || row.channel === "instagram"
      ? { channel: row.channel }
      : {}),
    ...whatsappSummary(row),
  }
}
export function registerTemplateRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "GET",
    path: "/templates",
    permission: "full_access",
    handler: async (ctx, { caller, query }) => {
      const channel = query.get("channel")
      if (
        channel !== null &&
        !channelValue.members.some(({ value }) => value === channel)
      )
        throw invalid(
          "The `channel` parameter must be email, whatsapp, messenger or instagram."
        )
      const result = await ctx.runQuery(internal.api.templates.list, {
        caller,
        ...listParams(query),
        ...(channel ? { channel: channel as TemplateChannel } : {}),
      })
      return {
        body: listBody(result, summary),
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
      if (row.channel === "whatsapp") {
        const summarized = summary(row)
        // Resend's template shape, with empty email fields.
        return {
          body: {
            object: "template",
            ...summarized,
            current_version_id: draft
              ? `${draft._id}:${row.version ?? 0}`
              : null,
            from: null,
            subject: "",
            reply_to: null,
            html: "",
            text: "",
            variables: row.variables.map((key) => ({
              id: `${row._id}:${key}`,
              created_at: apiTime(row._creationTime),
              updated_at: apiTime(row.updatedAt),
              key,
              type: "string",
              fallback_value: null,
            })),
            has_unpublished_versions:
              !published || row.updatedAt > (row.publishedAt ?? 0),
            whatsapp: {
              ...summarized.whatsapp,
              components: storedComponents(draft?.content),
            },
          },
        }
      }
      return {
        body: {
          object: "template",
          ...summary(row),
          current_version_id: draft ? `${draft._id}:${row.version ?? 0}` : null,
          from: row.from ?? null,
          subject: row.subject,
          reply_to:
            row.replyToAddresses ?? (row.replyTo ? [row.replyTo] : null),
          html: draft?.html ?? "",
          text: draft?.text ?? toPlainText(draft?.html ?? ""),
          ...(row.channel === "messenger" || row.channel === "instagram"
            ? { quick_replies: localTemplate(draft?.content).quick_replies }
            : {}),
          variables: resolvedVariables(row, draft ?? { html: "" }).map(
            (variable) => {
              const metadata = row.variableMetadata?.find(
                (entry) => entry.key === variable.key
              )
              return {
                id: metadata?.id ?? `${row._id}:${variable.key}`,
                created_at: apiTime(metadata?.createdAt ?? row._creationTime),
                updated_at: apiTime(metadata?.updatedAt ?? row.updatedAt),
                key: variable.key,
                type: variable.type ?? "string",
                fallback_value:
                  variable.fallback === undefined
                    ? null
                    : variable.type === "number"
                      ? Number(variable.fallback)
                      : variable.fallback,
              }
            }
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
      status: 201,
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
      handler: async (ctx, { caller, params, body }) => {
        /* A WhatsApp template is submitted to, or deleted at, Meta first:
           a Graph call cannot share the mutation's transaction. */
        if (kind === "publish" || kind === "remove") {
          const found = await ctx.runQuery(internal.api.templates.target, {
            caller,
            id: params.id,
          })
          if (found.channel === "whatsapp") {
            await ctx.runAction(
              kind === "publish"
                ? internal.whatsapp.templateActions.submitForCaller
                : internal.whatsapp.templateActions.removeForCaller,
              { caller, templateId: found.id }
            )
            return {
              body: {
                object: "template",
                id: found.id,
                ...(kind === "remove" ? { deleted: true } : {}),
              },
            }
          }
        }
        return {
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
        }
      },
    })
}
