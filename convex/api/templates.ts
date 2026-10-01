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
  type Input,
} from "../templates"
import { channelValue } from "../tables/channels"
import {
  PARAMETER_FORMATS,
  TEMPLATE_CATEGORIES,
  componentsParameterFormat,
  isTemplateName,
} from "../../lib/meta/templates"
import { storedComponents, whatsappSettings } from "../whatsapp/rows"
import { callerValue, requireCaller, invalid, requireTeamRow } from "./caller"
import { cursorPage, listArgs } from "./paging"
import {
  listBody,
  apiRoute,
  apiTime,
  enumField,
  listParams,
  objectBody,
  objectField,
  stringField,
  stringListField,
} from "./route"
import type { Doc } from "../_generated/dataModel"

function own(ctx: QueryCtx, organizationId: string, value: string) {
  return requireTeamRow(ctx, "templates", organizationId, value, "Template", {
    fallback: () => aliasOwner(ctx, organizationId, value),
  })
}
type Channel = "email" | "whatsapp" | "messenger" | "instagram"
const CHANNELS = ["email", "whatsapp", "messenger", "instagram"] as const

/** The optional `channel` of a request: email when absent. */
function channelField(input: Record<string, unknown>) {
  return enumField(input, "channel", CHANNELS)
}

/** A WhatsApp template's fields: its Meta name, the `whatsapp` settings
    and Meta's components. `parameter_format` must match the components'
    variables, which decide it. */
function whatsappFields(input: Record<string, unknown>, required: boolean) {
  const name = stringField(input, "name", required)
  if (name !== undefined && !isTemplateName(name))
    throw invalid(
      "WhatsApp template names use only lowercase letters, numbers and underscores."
    )
  for (const key of [
    "html",
    "text",
    "subject",
    "from",
    "reply_to",
    "variables",
  ])
    if (input[key] !== undefined)
      throw invalid(`WhatsApp templates have no \`${key}\` field.`)
  const whatsapp = objectField(input, "whatsapp") ?? {}
  const category = whatsapp.category
  if (
    category !== undefined &&
    (typeof category !== "string" ||
      !TEMPLATE_CATEGORIES.some((known) => known === category.toUpperCase()))
  )
    throw invalid(
      "The `whatsapp.category` field must be MARKETING, UTILITY or AUTHENTICATION."
    )
  const format = enumField(whatsapp, "parameter_format", PARAMETER_FORMATS)
  const raw = whatsapp.components
  if (raw !== undefined && !Array.isArray(raw))
    throw invalid("The `whatsapp.components` field must be an array.")
  const components = raw === undefined ? undefined : storedComponents(raw)
  if (components && components.length !== raw!.length)
    throw invalid("Every component needs a `type`.")
  if (format && components && componentsParameterFormat(components) !== format)
    throw invalid(
      "The `whatsapp.parameter_format` does not match the components' variables."
    )
  return {
    name,
    alias: stringField(input, "alias"),
    ...(components ? { content: components } : {}),
    whatsapp: {
      ...(whatsapp.waba_id !== undefined
        ? { wabaId: stringField(whatsapp, "waba_id")! }
        : {}),
      ...(whatsapp.language !== undefined
        ? { language: stringField(whatsapp, "language")! }
        : {}),
      ...(typeof category === "string"
        ? {
            category:
              category.toUpperCase() as (typeof TEMPLATE_CATEGORIES)[number],
          }
        : {}),
    },
  } satisfies Input
}

function inputFields(
  body: string,
  required = false,
  channel?: Channel
): Input & { channel: Channel } {
  const input = objectBody(JSON.parse(body))
  const asked = channelField(input)
  if (channel && asked && asked !== channel)
    throw invalid("A template's `channel` cannot change.")
  const resolved = channel ?? asked ?? "email"
  if (resolved === "messenger" || resolved === "instagram") {
    if (
      ["html", "subject", "from", "reply_to", "whatsapp"].some(
        (key) => input[key] !== undefined
      )
    )
      throw invalid("Messaging templates have no email or WhatsApp fields.")
    const text = stringField(input, "text", required)
    const quick_replies = input.quick_replies
    return {
      channel: resolved,
      name: stringField(input, "name", required),
      alias: stringField(input, "alias"),
      ...(input.text !== undefined || quick_replies !== undefined
        ? {
            content: {
              ...(input.text !== undefined ? { text } : {}),
              ...(quick_replies !== undefined ? { quick_replies } : {}),
            },
          }
        : {}),
      ...(input.text !== undefined ? { text } : {}),
    }
  }
  if (resolved === "whatsapp")
    return { ...whatsappFields(input, required), channel: resolved }
  if (input.whatsapp !== undefined)
    throw invalid("Only WhatsApp templates have a `whatsapp` field.")
  const replyToAddresses = stringListField(input, "reply_to", {
    rejectNull: true,
    message: "Invalid `reply_to` field.",
    emptyString: true,
  })
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
    channel: resolved,
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
          .filterWith(
            async (row) => !channel || (row.channel ?? "email") === channel
          )
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
    return { id: row._id, channel: row.channel ?? "email" }
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
            inputFields(body, false, row.channel ?? "email")
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
      if (channel !== null && !CHANNELS.some((known) => known === channel))
        throw invalid(
          "The `channel` parameter must be email, whatsapp, messenger or instagram."
        )
      const result = await ctx.runQuery(internal.api.templates.list, {
        caller,
        ...listParams(query),
        ...(channel ? { channel: channel as Channel } : {}),
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
