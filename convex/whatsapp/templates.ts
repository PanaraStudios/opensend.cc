import { v, ConvexError, type Infer } from "convex/values"
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { requireTeam } from "../access"
import { patchRow } from "../counts"
import { emitEvent } from "../events"
import { findMetaApp } from "../meta/app"
import { APP_MISSING } from "../meta/connect"
import { callerValue, requireCaller, type Caller } from "../api/caller"
import {
  teamTemplate,
  findDraft,
  findPublished,
  insertWhatsAppTemplate,
  removeTemplate,
} from "../templates"
import {
  resolvedTemplateValue,
  metaTemplateStatusValue,
  parameterFormatValue,
  templateCategoryValue,
  templateQualityValue,
  whatsappTemplateValue,
} from "../tables/templates"
import {
  componentFacts,
  isWhatsApp,
  namesakes,
  storedComponents,
  teamWabas,
  type WhatsAppTemplate,
} from "./rows"
import {
  readTemplateUpdate,
  sendableStatus,
  templateSendComponents,
  templateVariables,
  TemplateVariablesMissing,
  type ParameterFormat,
  type SendComponent,
  type TemplateComponent,
} from "../../lib/meta/templates"

/* WhatsApp templates at Meta: the rows the Node actions in
   templateActions.ts read and write, the webhook updates, the hourly sync's
   fan-out, and the lookup sends use. A template's row and draft live in
   convex/templates.ts like every other template. */

const NOT_FOUND = "Template not found"
export const NOT_CONNECTED =
  "This template's WhatsApp Business Account is not connected. Reconnect it on the Channels page."

/** The team's WhatsApp Business Accounts, for the editor's account picker. */
export const accounts = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({ wabaId: v.string(), name: v.optional(v.string()) })
  ),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "read")
    return (await teamWabas(ctx, organizationId)).map(({ wabaId, name }) => ({
      wabaId,
      ...(name ? { name } : {}),
    }))
  },
})

/** The WABA's connection and the app's Graph version, when it is live. */
async function wabaAccess(
  ctx: QueryCtx,
  organizationId: string,
  wabaId: string
) {
  const waba = await ctx.db
    .query("whatsappBusinessAccounts")
    .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
    .unique()
  if (!waba || waba.organizationId !== organizationId) return null
  const connection = await ctx.db.get("metaConnections", waba.connectionId)
  const app = await findMetaApp(ctx)
  if (connection?.status !== "active" || !app) return null
  return {
    connectionId: connection._id,
    encryptedToken: connection.encryptedToken,
    graphVersion: app.graphVersion,
    appId: app.appId,
  }
}
const accessValue = v.object({
  connectionId: v.id("metaConnections"),
  encryptedToken: v.string(),
  graphVersion: v.string(),
  appId: v.string(),
})

/** A WhatsApp template the caller may change: a dashboard user who may
    write to its team, or a REST caller of its team. */
async function changeable(
  ctx: QueryCtx,
  templateId: Id<"templates">,
  caller: Caller | undefined
) {
  const template = await ctx.db.get("templates", templateId)
  if (!template) throw new ConvexError(NOT_FOUND)
  if (caller) {
    await requireCaller(ctx, caller)
    if (template.organizationId !== caller.organizationId)
      throw new ConvexError(NOT_FOUND)
  } else await requireTeam(ctx, template.organizationId, "write")
  if (!isWhatsApp(template) || !template.whatsapp)
    throw new ConvexError("This is not a WhatsApp template")
  return { template, whatsapp: template.whatsapp }
}

/** What submitting a template to Meta needs. */
export const submitTarget = internalQuery({
  args: { templateId: v.id("templates"), caller: v.optional(callerValue) },
  returns: v.object({
    name: v.string(),
    updatedAt: v.number(),
    whatsapp: whatsappTemplateValue,
    components: v.any(),
    access: accessValue,
  }),
  handler: async (ctx, { templateId, caller }) => {
    const { template, whatsapp } = await changeable(ctx, templateId, caller)
    if (!(await findMetaApp(ctx))) throw new ConvexError(APP_MISSING)
    const access = await wabaAccess(
      ctx,
      template.organizationId,
      whatsapp.wabaId
    )
    if (!access) throw new ConvexError(NOT_CONNECTED)
    const draft = await findDraft(ctx, templateId)
    return {
      name: template.name,
      updatedAt: template.updatedAt,
      whatsapp,
      components: storedComponents(draft?.content),
      access,
    }
  },
})

/** Stores what Meta accepted: the template is published, its components
    are the live copy sends read, and its status follows Meta's review.
    An edit made while Meta answered stays unpublished. */
export const recordSubmission = internalMutation({
  args: {
    templateId: v.id("templates"),
    /** The row's `updatedAt` when its draft was read for submission. */
    updatedAt: v.number(),
    metaTemplateId: v.string(),
    metaStatus: metaTemplateStatusValue,
    category: v.optional(templateCategoryValue),
    components: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const template = await ctx.db.get("templates", args.templateId)
    if (!template?.whatsapp) return null
    const now = Math.max(Date.now(), template.updatedAt + 1)
    const edited = template.updatedAt !== args.updatedAt
    const publishedAt = edited ? args.updatedAt : now
    const components = storedComponents(args.components)
    await patchRow(ctx, "templates", template._id, {
      status: "published",
      publishedAt,
      ...(edited ? {} : { updatedAt: now }),
      whatsapp: {
        ...template.whatsapp,
        metaTemplateId: args.metaTemplateId,
        metaStatus: args.metaStatus,
        rejectedReason: undefined,
        ...(args.category ? { category: args.category } : {}),
        submittedAt: now,
      },
    })
    await writePublished(ctx, template, components, publishedAt)
    return null
  },
})

/** The live copy of a WhatsApp template: the components Meta has. */
async function writePublished(
  ctx: MutationCtx,
  template: Doc<"templates">,
  components: TemplateComponent[],
  publishedAt: number
) {
  const format = template.whatsapp?.parameterFormat ?? "positional"
  const version = {
    templateId: template._id,
    organizationId: template.organizationId,
    subject: "",
    preview: "",
    html: "",
    variables: templateVariables(components, format).map(({ key }) => ({
      key,
    })),
    components,
    publishedAt,
  }
  const live = await findPublished(ctx, template._id)
  if (live) await ctx.db.replace("publishedTemplates", live._id, version)
  else await ctx.db.insert("publishedTemplates", version)
}

/** What deleting a template at Meta needs; no access when Meta has nothing
    to delete or the WABA is gone, and then only the row goes. */
export const deleteTarget = internalQuery({
  args: { templateId: v.id("templates"), caller: v.optional(callerValue) },
  returns: v.object({
    name: v.string(),
    wabaId: v.string(),
    metaTemplateId: v.optional(v.string()),
    access: v.union(accessValue, v.null()),
  }),
  handler: async (ctx, { templateId, caller }) => {
    const { template, whatsapp } = await changeable(ctx, templateId, caller)
    const atMeta =
      whatsapp.metaTemplateId !== undefined &&
      whatsapp.metaStatus !== "DELETED" &&
      whatsapp.metaStatus !== "PENDING_DELETION"
    return {
      name: template.name,
      wabaId: whatsapp.wabaId,
      ...(atMeta ? { metaTemplateId: whatsapp.metaTemplateId } : {}),
      access: atMeta
        ? await wabaAccess(ctx, template.organizationId, whatsapp.wabaId)
        : null,
    }
  },
})

export const removeLocal = internalMutation({
  args: { templateId: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get("templates", templateId)
    if (template) await removeTemplate(ctx, template)
    return null
  },
})

/* ------------------------------------------------------------------ sync */

/** The WABAs a dashboard user syncs. */
export const teamWabaIds = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId, "write")
    return (await teamWabas(ctx, organizationId)).map((waba) => waba.wabaId)
  },
})

/** A WABA's team and live connection, or null when it cannot be synced. */
export const syncTarget = internalQuery({
  args: { wabaId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ organizationId: v.string(), access: accessValue })
  ),
  handler: async (ctx, { wabaId }) => {
    const waba = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
      .unique()
    if (!waba) return null
    const access = await wabaAccess(ctx, waba.organizationId, wabaId)
    return access ? { organizationId: waba.organizationId, access } : null
  },
})

const metaTemplateValue = v.object({
  id: v.string(),
  name: v.string(),
  language: v.string(),
  category: templateCategoryValue,
  status: metaTemplateStatusValue,
  parameterFormat: parameterFormatValue,
  components: v.any(),
  rejectedReason: v.optional(v.string()),
  quality: v.optional(templateQualityValue),
})

/** One page of a sync: each Meta template updates the row with its id, or
    adopts a draft with its WABA, name and language, or becomes a new
    published template. A draft with unsubmitted edits keeps them; the
    live copy always follows Meta. */
export const upsertSynced = internalMutation({
  args: {
    organizationId: v.string(),
    wabaId: v.string(),
    syncedAt: v.number(),
    templates: v.array(metaTemplateValue),
  },
  returns: v.null(),
  handler: async (ctx, { organizationId, wabaId, syncedAt, templates }) => {
    const waba = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", wabaId))
      .unique()
    // The WABA left the team while the sync ran.
    if (waba?.organizationId !== organizationId) return null
    for (const meta of templates) {
      const components = storedComponents(meta.components)
      const fields = {
        metaTemplateId: meta.id,
        metaStatus: meta.status,
        rejectedReason: meta.rejectedReason,
        quality: meta.quality,
        category: meta.category,
        parameterFormat: meta.parameterFormat,
      }
      const row =
        (await byMetaId(ctx, organizationId, meta.id)) ??
        (await namesakes(ctx, organizationId, meta.name, meta.language)).find(
          (candidate) => candidate.whatsapp?.wabaId === wabaId
        )
      if (!row) {
        const id = await insertWhatsAppTemplate(ctx, organizationId, {
          name: meta.name,
          content: components,
          whatsapp: { wabaId, language: meta.language, ...fields, syncedAt },
          status: "published",
        })
        const inserted = (await ctx.db.get("templates", id))!
        await writePublished(ctx, inserted, components, inserted.updatedAt)
        continue
      }
      const draft = await findDraft(ctx, row._id)
      const live = await findPublished(ctx, row._id)
      const pending =
        live !== null &&
        JSON.stringify(draft?.content ?? null) !==
          JSON.stringify(live.components ?? null)
      const same =
        JSON.stringify(live?.components ?? null) === JSON.stringify(components)
      const metadataChanged = Object.entries(fields).some(
        ([key, value]) =>
          row.whatsapp?.[key as keyof NonNullable<typeof row.whatsapp>] !==
          value
      )
      if (
        same &&
        !metadataChanged &&
        row.status === "published" &&
        row.publishedAt !== undefined
      )
        continue
      const now = Math.max(Date.now(), row.updatedAt + 1)
      const publishedAt = same ? (row.publishedAt ?? now) : now
      await patchRow(ctx, "templates", row._id, {
        status: "published",
        publishedAt,
        whatsapp: { ...row.whatsapp!, ...fields, syncedAt },
        ...(pending || same
          ? {}
          : {
              updatedAt: now,
              variables: componentFacts(components).variables,
            }),
      })
      if (!same) await writePublished(ctx, row, components, publishedAt)
      if (!pending && !same && draft)
        await ctx.db.patch("templateDrafts", draft._id, { content: components })
    }
    return null
  },
})

/** The team's template with a Meta id: a WABA that moved teams leaves
    the old team's rows behind. */
const byMetaId = async (
  ctx: QueryCtx,
  organizationId: string,
  metaTemplateId: string
) =>
  (
    await ctx.db
      .query("templates")
      .withIndex("by_whatsapp_metaTemplateId", (q) =>
        q.eq("whatsapp.metaTemplateId", metaTemplateId)
      )
      .take(20)
  ).find((row) => row.organizationId === organizationId) ?? null

/** After a complete sync: templates of the WABA Meta no longer lists are
    marked deleted, a page at a time, then the WABA records the sync. */
export const finishSync = internalMutation({
  args: {
    organizationId: v.string(),
    wabaId: v.string(),
    syncedAt: v.number(),
    cursor: v.union(v.string(), v.null()),
    seenMetaIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = new Set(args.seenMetaIds)
    const page = await ctx.db
      .query("templates")
      .withIndex("by_organizationId_and_channel", (q) =>
        q.eq("organizationId", args.organizationId).eq("channel", "whatsapp")
      )
      .paginate({ cursor: args.cursor, numItems: 200 })
    for (const row of page.page) {
      const whatsapp = row.whatsapp
      if (
        whatsapp?.wabaId === args.wabaId &&
        whatsapp.metaTemplateId &&
        whatsapp.metaStatus !== "DELETED" &&
        !seen.has(whatsapp.metaTemplateId) &&
        (whatsapp.submittedAt ?? 0) < args.syncedAt
      )
        await patchRow(ctx, "templates", row._id, {
          whatsapp: { ...whatsapp, metaStatus: "DELETED" },
        })
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.whatsapp.templates.finishSync, {
        ...args,
        cursor: page.continueCursor,
      })
      return null
    }
    const waba = await ctx.db
      .query("whatsappBusinessAccounts")
      .withIndex("by_wabaId", (q) => q.eq("wabaId", args.wabaId))
      .unique()
    if (waba?.organizationId === args.organizationId)
      await ctx.db.patch("whatsappBusinessAccounts", waba._id, {
        templatesSyncedAt: args.syncedAt,
      })
    return null
  },
})

/** The hourly fallback: one scheduled sync per WABA, a page at a time. */
export const dispatchSync = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("whatsappBusinessAccounts")
      .paginate({ cursor: cursor ?? null, numItems: 100 })
    for (const waba of page.page)
      await ctx.scheduler.runAfter(
        0,
        internal.whatsapp.templateActions.syncAccount,
        { wabaId: waba.wabaId }
      )
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.whatsapp.templates.dispatchSync,
        {
          cursor: page.continueCursor,
        }
      )
    return null
  },
})

/* -------------------------------------------------------------- webhooks */

/** Applies a template webhook (status, category or quality) to the team's
    template with its Meta id, and says which template it was. */
export async function applyTemplateWebhook(
  ctx: MutationCtx,
  organizationId: string,
  wabaId: string,
  field: string,
  value: Record<string, unknown>
): Promise<Id<"templates"> | null> {
  const update = readTemplateUpdate(field, value)
  if (!update) return null
  if (update.resync)
    await ctx.scheduler.runAfter(
      0,
      internal.whatsapp.templateActions.syncAccount,
      { wabaId }
    )
  const template = await byMetaId(ctx, organizationId, update.metaTemplateId)
  if (!template?.whatsapp || template.whatsapp.wabaId !== wabaId) return null
  const next: WhatsAppTemplate = { ...template.whatsapp }
  if (update.metaStatus) next.metaStatus = update.metaStatus
  if (update.rejectedReason !== undefined)
    next.rejectedReason = update.rejectedReason ?? undefined
  if (update.category) next.category = update.category
  if (update.quality) next.quality = update.quality
  await patchRow(ctx, "templates", template._id, { whatsapp: next })
  return template._id
}

/** Emits `whatsapp.template.status_updated` for a template webhook, naming
    the template when one matched. */
export async function templateWebhook(
  ctx: MutationCtx,
  organizationId: string,
  wabaId: string,
  field: string,
  value: Record<string, unknown>
) {
  const templateId = await applyTemplateWebhook(
    ctx,
    organizationId,
    wabaId,
    field,
    value
  )
  await emitEvent(ctx, organizationId, "whatsapp.template.status_updated", {
    channel: "whatsapp",
    waba_id: wabaId,
    field,
    ...(templateId ? { template_id: templateId } : {}),
    ...value,
  })
}

/* ---------------------------------------------------------------- sends */

export { resolvedTemplateValue } from "../tables/templates"
export type ResolvedTemplate = Infer<typeof resolvedTemplateValue>

export type TemplateRef = {
  id?: string
  alias?: string
  name?: string
  /** Picks among a name's languages; required with a name. */
  language?: string
  /** The sending number's WABA: the template must belong to it. */
  wabaId?: string
}

/** An approved WhatsApp template of the team, by id, alias, or name and
    language, with what a send needs: Meta's name, language and parameter
    format, and `components(variables)`, which turns a variables record
    into the message's `template.components` (throwing a ConvexError that
    names the missing ones). Broadcasts, automations and the send API call
    it; it throws a ConvexError a caller can show when nothing matches. */
export async function resolveWhatsAppTemplate(
  ctx: QueryCtx,
  organizationId: string,
  ref: TemplateRef
): Promise<
  ResolvedTemplate & {
    sendComponents: (
      variables: Readonly<Record<string, string | number | undefined>>
    ) => SendComponent[]
  }
> {
  const resolved = await findResolved(ctx, organizationId, ref)
  return {
    ...resolved,
    sendComponents: (variables) => whatsappSendComponents(resolved, variables),
  }
}

/** A resolved template's `template.components` for one send. */
export function whatsappSendComponents(
  template: Pick<ResolvedTemplate, "components" | "parameterFormat">,
  variables: Readonly<Record<string, string | number | undefined>>
) {
  try {
    return templateSendComponents(
      storedComponents(template.components),
      template.parameterFormat as ParameterFormat,
      variables
    )
  } catch (error) {
    if (error instanceof TemplateVariablesMissing)
      throw new ConvexError(error.message)
    throw error
  }
}

async function findResolved(
  ctx: QueryCtx,
  organizationId: string,
  ref: TemplateRef
): Promise<ResolvedTemplate> {
  let template: Doc<"templates"> | null = null
  const id = ref.id ? ctx.db.normalizeId("templates", ref.id) : null
  if (id) template = await teamTemplate(ctx, organizationId, id, "whatsapp")
  else if (ref.alias)
    template = await teamTemplate(ctx, organizationId, ref.alias, "whatsapp")
  else if (ref.name) {
    if (!ref.language)
      throw new ConvexError("Give the template's language with its name")
    const rows = (
      await namesakes(ctx, organizationId, ref.name, ref.language)
    ).filter((row) => !ref.wabaId || row.whatsapp?.wabaId === ref.wabaId)
    // The approved one wins over drafts of the same name.
    template =
      rows.find((row) => sendableStatus(row.whatsapp?.metaStatus)) ??
      rows[0] ??
      null
  } else throw new ConvexError("Name the template by id, alias or name")
  if (
    !template ||
    template.organizationId !== organizationId ||
    !isWhatsApp(template) ||
    !template.whatsapp
  )
    throw new ConvexError("WhatsApp template not found")
  const whatsapp = template.whatsapp
  if (ref.language && ref.language !== whatsapp.language)
    throw new ConvexError(
      `This template is in ${whatsapp.language}, not ${ref.language}`
    )
  if (ref.wabaId && ref.wabaId !== whatsapp.wabaId)
    throw new ConvexError(
      "This template belongs to another WhatsApp Business Account"
    )
  const live = await findPublished(ctx, template._id)
  if (!live || !sendableStatus(whatsapp.metaStatus))
    throw new ConvexError("This WhatsApp template is not approved by Meta yet")
  const components = storedComponents(live.components)
  return {
    templateId: template._id,
    name: template.name,
    language: whatsapp.language,
    wabaId: whatsapp.wabaId,
    category: whatsapp.category,
    parameterFormat: whatsapp.parameterFormat,
    variables: templateVariables(components, whatsapp.parameterFormat).map(
      ({ key }) => key
    ),
    components,
  }
}

/** `resolveWhatsAppTemplate` for actions, without the function. */
export const resolve = internalQuery({
  args: {
    organizationId: v.string(),
    id: v.optional(v.string()),
    alias: v.optional(v.string()),
    name: v.optional(v.string()),
    language: v.optional(v.string()),
    wabaId: v.optional(v.string()),
  },
  returns: resolvedTemplateValue,
  handler: (ctx, { organizationId, ...ref }) =>
    findResolved(ctx, organizationId, ref),
})
