import { includeSelected, OPTION_LIMIT } from "../lib/dashboard/options"
import { selectedOption, hasTeamRows, teamRow, searchOptions } from "./lists"
import { stream } from "convex-helpers/server/stream"
import { v, ConvexError, type Infer } from "convex/values"
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server"
import { query, mutation, internalQuery } from "./_generated/server"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import schema from "./schema"
import { requireTeam } from "./access"
import { renderEmail } from "./email/render"
import {
  countValue,
  counters,
  deleteRow,
  insertRow,
  literals,
  patchRow,
} from "./counts"
import { filteredPage, matchesSearch } from "./lists"
import {
  templateStatusValue,
  templateVariableValue,
  whatsappTemplateValue,
} from "./tables/templates"
import { channelValue } from "./tables/channels"
import {
  assertChangeAllowed,
  assertNameFree,
  componentFacts,
  emptyComponents,
  freeTemplateName,
  isWhatsApp,
  whatsappSettings,
  type WhatsAppSettings,
  type WhatsAppTemplate,
} from "./whatsapp/rows"
import { templateNameFrom } from "../lib/meta/templates"
import { UNSUBSCRIBE_VARIABLE_NAME } from "../lib/dashboard/email-variables"
import {
  MAX_TEMPLATE_VARIABLES,
  publishedAtAfterEdit,
  renamedTemplateAlias,
  TEMPLATE_ALIAS_TAKEN,
  templateAliasBase,
  templateAliasError,
  templateVariableDefaults,
  templateVariables,
  uniqueTemplateAlias,
  UNTITLED_TEMPLATE,
} from "../lib/dashboard/template"
import { parseMailbox } from "../lib/dashboard/email-send"
import type { EmailTemplate } from "../lib/dashboard/types"

/* A document holds at most 1 MB, so the draft's markup and its editor
   document each get a quarter of it. */
export const TEMPLATE_BODY_LIMIT = 256 * 1024
const TEXT_LIMITS = {
  name: ["Name", 256],
  alias: ["Alias", 128],
  subject: ["Subject", 998],
  preview: ["Preview text", 1000],
  from: ["From", 512],
  replyTo: ["Reply-to", 512],
} as const
const bytes = (value: string) => new TextEncoder().encode(value).length

/** The WhatsApp settings an edit may change; the rest follow Meta. */
export const whatsappSettingsValue = whatsappTemplateValue
  .pick("wabaId", "language", "category")
  .partial()

export const draftFields = {
  text: v.optional(v.string()),
  variableDefinitions: v.optional(v.array(templateVariableValue)),
  replyToAddresses: v.optional(v.array(v.string())),
  subject: v.optional(v.string()),
  preview: v.optional(v.string()),
  html: v.optional(v.string()),
  /** The editor document; null drops it, when the email became hand-written. */
  content: v.optional(v.any()),
  from: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  whatsapp: v.optional(whatsappSettingsValue),
}
export type Input = Partial<
  Record<keyof typeof TEXT_LIMITS | "html" | "text", string> & {
    content: unknown
    variableDefinitions: Infer<typeof templateVariableValue>[]
    replyToAddresses: string[]
    whatsapp: Partial<WhatsAppSettings>
  }
>
type Draft = Pick<EmailTemplate, "name" | "subject" | "preview" | "html"> & {
  content?: unknown
  text?: string
  variableDefinitions?: Infer<typeof templateVariableValue>[]
  replyToAddresses?: string[]
  from?: string
  replyTo?: string
  /** Absent or email for an email template. */
  channel?: Infer<typeof channelValue>
  whatsapp?: Partial<WhatsAppSettings>
}

function checkInput(input: Input) {
  if (input.text !== undefined && bytes(input.text) > TEMPLATE_BODY_LIMIT)
    throw new ConvexError("The template text is larger than 256 KB")
  if (input.variableDefinitions) validateVariables(input.variableDefinitions)
  if (
    input.replyToAddresses &&
    (input.replyToAddresses.length > 50 ||
      input.replyToAddresses.some((address) => !parseMailbox(address)))
  )
    throw new ConvexError("Invalid reply-to addresses")
  for (const [key, [label, limit]] of Object.entries(TEXT_LIMITS))
    if ((input[key as keyof typeof TEXT_LIMITS]?.length ?? 0) > limit)
      throw new ConvexError(`${label} is too long`)
  if (input.html !== undefined && bytes(input.html) > TEMPLATE_BODY_LIMIT)
    throw new ConvexError("The template HTML is larger than 256 KB")
  if (
    input.content != null &&
    bytes(JSON.stringify(input.content)) > TEMPLATE_BODY_LIMIT
  )
    throw new ConvexError("The template design is larger than 256 KB")
}
function draftVariables(draft: Draft) {
  const variables = [
    ...new Set([
      ...templateVariables(draft),
      ...templateVariables({
        subject: "",
        preview: "",
        html: draft.text ?? "",
      }),
      ...(draft.variableDefinitions ?? []).map((variable) => variable.key),
    ]),
  ]
  if (variables.length > MAX_TEMPLATE_VARIABLES)
    throw new ConvexError(
      `A template can use at most ${MAX_TEMPLATE_VARIABLES} variables`
    )
  return variables
}
const searchText = (name: string, alias: string) =>
  `${name} ${alias.replace(/[-_]+/g, " ")}`
/** Empty text clears an optional envelope field. */
const optionalText = (value: string | undefined) => value?.trim() || undefined

async function findTemplate(ctx: QueryCtx, id: Id<"templates">) {
  const template = await ctx.db.get("templates", id)
  if (!template) throw new ConvexError("Template not found")
  return template
}
async function writable(ctx: MutationCtx, id: Id<"templates">) {
  const template = await findTemplate(ctx, id)
  await requireTeam(ctx, template.organizationId, "write")
  return template
}
export const findDraft = (ctx: QueryCtx, templateId: Id<"templates">) =>
  ctx.db
    .query("templateDrafts")
    .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
    .unique()
export const findPublished = (ctx: QueryCtx, templateId: Id<"templates">) =>
  ctx.db
    .query("publishedTemplates")
    .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
    .unique()
export const aliasOwner = (
  ctx: QueryCtx,
  organizationId: string,
  alias: string
) =>
  ctx.db
    .query("templates")
    .withIndex("by_organizationId_and_alias", (q) =>
      q.eq("organizationId", organizationId).eq("alias", alias)
    )
    .first()
/** The team's aliases a name's alias could be numbered against. */
async function aliasesNear(
  ctx: QueryCtx,
  organizationId: string,
  name: string
) {
  const base = templateAliasBase(name)
  const rows = await ctx.db
    .query("templates")
    .withIndex("by_organizationId_and_alias", (q) =>
      q
        .eq("organizationId", organizationId)
        .gte("alias", base)
        .lt("alias", `${base}￿`)
    )
    .take(1000)
  return rows.map((row) => ({ id: row._id as string, alias: row.alias }))
}
/** Past a thousand numbered namesakes the helper may land on a taken alias. */
async function checkFree(ctx: QueryCtx, organizationId: string, alias: string) {
  if (await aliasOwner(ctx, organizationId, alias))
    throw new ConvexError(TEMPLATE_ALIAS_TAKEN)
}

export async function insertTemplate(
  ctx: MutationCtx,
  organizationId: string,
  draft: Draft
) {
  checkInput(draft)
  if (draft.channel === "whatsapp")
    return insertWhatsAppTemplate(ctx, organizationId, {
      name: draft.name,
      content: draft.content,
      whatsapp: await whatsappSettings(
        ctx,
        organizationId,
        draft.whatsapp ?? {}
      ),
      uniqueName: true,
    })
  if (draft.channel !== undefined && draft.channel !== "email")
    throw new ConvexError("Templates can be email or WhatsApp")
  const name = draft.name.trim() || UNTITLED_TEMPLATE
  const alias = uniqueTemplateAlias(
    name,
    await aliasesNear(ctx, organizationId, name)
  )
  await checkFree(ctx, organizationId, alias)
  const id = await insertRow(ctx, "templates", {
    organizationId,
    name,
    alias,
    status: "draft",
    subject: draft.subject,
    preview: draft.preview,
    from: optionalText(draft.from),
    replyTo: optionalText(draft.replyTo),
    variables: draftVariables(draft),
    variableDefinitions: draft.variableDefinitions,
    replyToAddresses: draft.replyToAddresses,
    updatedAt: Date.now(),
    version: 1,
    searchText: searchText(name, alias),
  })
  await ctx.db.insert("templateDrafts", {
    templateId: id,
    html: draft.html,
    text: draft.text,
    ...(draft.content != null ? { content: draft.content } : {}),
  })
  const row = (await ctx.db.get("templates", id))!
  await patchRow(ctx, "templates", id, {
    variableMetadata: variableMetadata(
      row,
      resolvedVariables(row, draft),
      row._creationTime
    ),
  })
  return id
}

/** A WhatsApp template: its row, and its draft holding the components.
    `uniqueName` numbers a taken name instead of refusing it. A template
    synced from Meta arrives published, with its Meta fields. */
export async function insertWhatsAppTemplate(
  ctx: MutationCtx,
  organizationId: string,
  input: {
    name: string
    content?: unknown
    whatsapp: WhatsAppSettings & Partial<WhatsAppTemplate>
    uniqueName?: boolean
    status?: Doc<"templates">["status"]
  }
) {
  checkInput({ name: input.name, content: input.content })
  const target = input.whatsapp
  const name = input.uniqueName
    ? await freeTemplateName(ctx, organizationId, input.name, target)
    : templateNameFrom(input.name)
  if (!input.uniqueName)
    await assertNameFree(ctx, organizationId, { ...target, name })
  const facts = componentFacts(input.content ?? emptyComponents())
  const alias = uniqueTemplateAlias(
    name,
    await aliasesNear(ctx, organizationId, name)
  )
  await checkFree(ctx, organizationId, alias)
  const now = Date.now()
  const id = await insertRow(ctx, "templates", {
    organizationId,
    channel: "whatsapp",
    name,
    alias,
    status: input.status ?? "draft",
    subject: "",
    preview: "",
    variables: facts.variables,
    updatedAt: now,
    version: 1,
    searchText: searchText(name, alias),
    whatsapp: {
      ...target,
      parameterFormat: target.parameterFormat ?? facts.parameterFormat,
    },
    ...(input.status === "published" ? { publishedAt: now } : {}),
  })
  await ctx.db.insert("templateDrafts", {
    templateId: id,
    html: "",
    content: facts.components,
  })
  return id
}

const listItem = schema.doc("templates").extend({ html: v.string() })

const templateFilters = {
  organizationId: v.string(),
  /** Part of the name or alias, as typed. */
  search: v.optional(v.string()),
  status: v.optional(templateStatusValue),
  channel: v.optional(channelValue),
}
/** Email templates store no channel, so "email" reads as absent. */
export const storedChannel = (
  channel: Infer<typeof channelValue> | undefined
) => (channel === "email" ? undefined : channel)
export const templateChannel = (row: Pick<Doc<"templates">, "channel">) =>
  row.channel ?? "email"

// Scan 512 metadata rows; reserve one maximum-size (1 MiB) draft per match.
export const TEMPLATE_SEARCH_BUDGET = {
  rows: 512,
  bytes: 8 * 1024 * 1024,
  bytesPerMatch: 1024 * 1024,
}

export const list = query({
  args: { ...templateFilters, paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listItem),
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    const search = args.search
    const matches = matchesSearch(search)
    const templates = stream(ctx.db, schema).query("templates")
    const channel = args.channel
    /* By channel the list keeps its newest-first order and narrows the
       status per page; the status alone has its own index. */
    const rows = channel
      ? templates
          .withIndex("by_organizationId_and_channel", (q) =>
            q
              .eq("organizationId", args.organizationId)
              .eq("channel", storedChannel(channel))
          )
          .order("desc")
      : args.status
        ? templates
            .withIndex("by_organizationId_and_status", (q) =>
              q
                .eq("organizationId", args.organizationId)
                .eq("status", args.status!)
            )
            .order("desc")
        : templates
            .withIndex("by_organizationId", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .order("desc")
    const result = await filteredPage(
      rows,
      args.paginationOpts,
      (row) =>
        (!channel || !args.status || row.status === args.status) &&
        matches(row.name, row.alias),
      TEMPLATE_SEARCH_BUDGET,
      search
    )
    // The cards draw each email, so the page carries the draft markup.
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => ({
          ...row,
          html: (await findDraft(ctx, row._id))?.html ?? "",
        }))
      ),
    }
  },
})

export const count = query({
  args: templateFilters,
  returns: countValue,
  handler: async (ctx, args) => {
    await requireTeam(ctx, args.organizationId)
    // The counts are kept by status only.
    if (args.search?.trim() || args.channel) return { total: null }
    return {
      total: await counters.templates.total(ctx, args.organizationId, [
        { is: args.status, among: literals(templateStatusValue) },
      ]),
    }
  },
})

/** Whether the team has any template at all, whatever the list's filters:
    the list says "No templates yet" only when it has none. */
export const hasAny = query({
  args: { organizationId: v.string() },
  returns: v.boolean(),
  handler: (ctx, { organizationId }) =>
    hasTeamRows(ctx, "templates", organizationId),
})

/** The team's newest templates, without their bodies: for pickers on other
    screens, which re-render on every autosave. */
export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedId: v.optional(v.id("templates")),
    /** Email when left out: the email pickers predate channels. */
    channel: v.optional(channelValue),
  },
  returns: v.array(schema.doc("templates")),
  handler: async (ctx, { organizationId, search, selectedId, channel }) => {
    await requireTeam(ctx, organizationId, "read")
    const rows = search?.trim()
      ? (await searchOptions(ctx, "templates", organizationId, search)).filter(
          (row) => templateChannel(row) === (channel ?? "email")
        )
      : await ctx.db
          .query("templates")
          .withIndex("by_organizationId_and_channel", (q) =>
            q
              .eq("organizationId", organizationId)
              .eq("channel", storedChannel(channel ?? "email"))
          )
          .order("desc")
          .take(OPTION_LIMIT)
    return includeSelected(
      rows,
      await selectedOption(ctx, "templates", organizationId, selectedId),
      (row) => row._id
    )
  },
})

/** A template of the active team with its draft, or null. */
export const get = query({
  args: { organizationId: v.string(), id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      template: schema.doc("templates"),
      html: v.string(),
      content: v.optional(v.any()),
    })
  ),
  handler: async (ctx, { organizationId, id }) => {
    await requireTeam(ctx, organizationId)
    const template = await teamRow(ctx, "templates", organizationId, id)
    if (!template) return null
    const draft = await findDraft(ctx, template._id)
    return { template, html: draft?.html ?? "", content: draft?.content }
  },
})

export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    channel: v.optional(channelValue),
    ...draftFields,
  },
  returns: v.id("templates"),
  handler: async (ctx, { organizationId, ...input }) => {
    await requireTeam(ctx, organizationId, "write")
    return insertTemplate(ctx, organizationId, {
      ...input,
      subject: (input.subject ?? "").trim(),
      preview: input.preview ?? "",
      html: input.html ?? "",
    })
  },
})

/** Saves an edit to the draft. Fields left out, or equal to what is stored,
    are not written; the published copy is never touched. */
export const update = mutation({
  args: {
    id: v.id("templates"),
    name: v.optional(v.string()),
    alias: v.optional(v.string()),
    ...draftFields,
  },
  returns: v.null(),
  handler: async (ctx, { id, ...input }) => {
    const template = await writable(ctx, id)
    return updateTemplate(ctx, template, input)
  },
})

/** Copies the draft into the published version, which every send uses. */
export const publish = mutation({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const template = await writable(ctx, id)
    return publishTemplate(ctx, template)
  },
})

/** Back to draft: nothing is live, so sends by id or alias fail. The alias
    stays put, since callers may still use it. */
export const unpublish = mutation({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const template = await writable(ctx, id)
    if (isWhatsApp(template))
      throw new ConvexError(
        "A WhatsApp template stays at Meta until you delete it"
      )
    const live = await findPublished(ctx, id)
    if (live) await ctx.db.delete("publishedTemplates", live._id)
    if (template.status === "published")
      await patchRow(ctx, "templates", id, {
        status: "draft",
        updatedAt: Date.now(),
      })
    return null
  },
})

/** A new draft with the same email. */
export const duplicate = mutation({
  args: { id: v.id("templates") },
  returns: v.id("templates"),
  handler: async (ctx, { id }) => {
    const template = await writable(ctx, id)
    return duplicateTemplate(ctx, template)
  },
})

export const DELETE_AT_META =
  "This template is at Meta: delete it there through WhatsApp"

export const remove = mutation({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const template = await writable(ctx, id)
    if (template.whatsapp?.metaTemplateId) throw new ConvexError(DELETE_AT_META)
    return removeTemplate(ctx, template)
  },
})

export const publishedTemplateValue = schema
  .doc("publishedTemplates")
  .omit("_id", "_creationTime", "templateId", "organizationId")
  .extend({ id: v.id("templates"), name: v.string(), alias: v.string() })
export type PublishedTemplate = Infer<typeof publishedTemplateValue>

/** The live version of a team's template, by id or alias; null when there is
    no such template or it is not published. Sends read only this. */
export async function publishedTemplate(
  ctx: QueryCtx,
  organizationId: string,
  idOrAlias: string
): Promise<PublishedTemplate | null> {
  const id = ctx.db.normalizeId("templates", idOrAlias)
  const template: Doc<"templates"> | null = id
    ? await ctx.db.get("templates", id)
    : await aliasOwner(ctx, organizationId, idOrAlias)
  // An email send never takes a WhatsApp template.
  if (
    !template ||
    template.organizationId !== organizationId ||
    isWhatsApp(template)
  )
    return null
  const live = await findPublished(ctx, template._id)
  if (!live) return null
  const {
    subject,
    preview,
    html,
    text,
    from,
    replyTo,
    replyToAddresses,
    variables,
    publishedAt,
  } = live
  return {
    id: template._id,
    name: template.name,
    alias: template.alias,
    subject,
    preview,
    html,
    variables,
    text,
    replyToAddresses,
    publishedAt,
    ...(from !== undefined ? { from } : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
  }
}
export const published = internalQuery({
  args: { organizationId: v.string(), idOrAlias: v.string() },
  returns: v.union(v.null(), publishedTemplateValue),
  handler: (ctx, args) =>
    publishedTemplate(ctx, args.organizationId, args.idOrAlias),
})

/** Filled by the sender for each recipient, never by the caller. */
const senderFilled = (key: string) =>
  key.startsWith("contact.") || key === UNSUBSCRIBE_VARIABLE_NAME

/** One recipient's copy of a published template. As in Resend, a variable
    left out takes its default, and one with no default fails the send. */
export function renderTemplate(
  template: Pick<PublishedTemplate, "subject" | "html" | "text" | "variables">,
  values: Readonly<Record<string, string | number | undefined>>
) {
  const filled: Record<string, string> = Object.create(null)
  const missing: string[] = []
  for (const { key, fallback, type } of template.variables) {
    const given = Object.hasOwn(values, key) ? values[key] : undefined
    if (
      given !== undefined &&
      given !== "" &&
      type &&
      (typeof given !== type || (type === "number" && !Number.isFinite(given)))
    )
      throw new ConvexError(`Invalid type for template variable: ${key}`)
    const value = given === undefined || given === "" ? fallback : String(given)
    if (value !== undefined) filled[key] = value
    else if (!senderFilled(key)) missing.push(key)
  }
  if (missing.length)
    throw new ConvexError(`Missing template variables: ${missing.join(", ")}`)
  return renderEmail(
    { subject: template.subject, html: template.html, text: template.text },
    filled
  )
}

/** A new alias the caller asked for, checked; undefined when unchanged. */
async function chosenAlias(
  ctx: QueryCtx,
  template: Doc<"templates">,
  input: string | undefined
) {
  const alias = input?.trim()
  if (alias === undefined || alias === template.alias) return undefined
  const error = templateAliasError(
    alias,
    (await aliasOwner(ctx, template.organizationId, alias)) ? [{ alias }] : []
  )
  if (error) throw new ConvexError(error)
  return alias
}

/** The alias after an edit: the one chosen, or the one that follows a
    rename until the template has been published. */
async function aliasAfterEdit(
  ctx: QueryCtx,
  template: Doc<"templates">,
  chosen: string | undefined,
  name: string | undefined
) {
  if (chosen !== undefined) return chosen
  const publishedAt = template.publishedAt ?? null
  if (name === undefined || publishedAt !== null) return template.alias
  const alias = renamedTemplateAlias(
    {
      id: template._id,
      name: template.name,
      alias: template.alias,
      publishedAt,
    },
    name,
    await aliasesNear(ctx, template.organizationId, name)
  )
  if (alias !== template.alias)
    await checkFree(ctx, template.organizationId, alias)
  return alias
}

const EMAIL_FIELDS = [
  "subject",
  "preview",
  "html",
  "text",
  "from",
  "replyTo",
  "variableDefinitions",
  "replyToAddresses",
] as const

/** An edit of a WhatsApp draft: its name, Meta settings and components.
    What Meta fixes once a template is submitted stays fixed. */
async function updateWhatsAppTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">,
  input: Input
) {
  const current = template.whatsapp
  const draft = await findDraft(ctx, template._id)
  if (!current || !draft) throw new ConvexError("Template not found")
  if (EMAIL_FIELDS.some((key) => input[key] !== undefined))
    throw new ConvexError("WhatsApp templates have no email fields")
  const name =
    input.name !== undefined ? templateNameFrom(input.name) : template.name
  const renamed = name !== template.name
  const settings = await whatsappSettings(
    ctx,
    template.organizationId,
    input.whatsapp ?? {},
    current
  )
  assertChangeAllowed(current, settings, renamed)
  const moved =
    settings.wabaId !== current.wabaId || settings.language !== current.language
  if (renamed || moved)
    await assertNameFree(
      ctx,
      template.organizationId,
      { ...settings, name },
      template._id
    )
  const contentChanged =
    input.content !== undefined &&
    JSON.stringify(input.content ?? null) !==
      JSON.stringify(draft.content ?? null)
  const sent = contentChanged || settings.category !== current.category
  const alias = await chosenAlias(ctx, template, input.alias)
  if (!renamed && !moved && !sent && alias === undefined) return null
  const facts = componentFacts(contentChanged ? input.content : draft.content)
  const now = Math.max(Date.now(), template.updatedAt + 1)
  const nextAlias = await aliasAfterEdit(
    ctx,
    template,
    alias,
    renamed ? name : undefined
  )
  await patchRow(ctx, "templates", template._id, {
    name,
    alias: nextAlias,
    variables: facts.variables,
    whatsapp: {
      ...current,
      ...settings,
      parameterFormat: facts.parameterFormat,
    },
    updatedAt: now,
    version: (template.version ?? 0) + 1,
    publishedAt:
      publishedAtAfterEdit(
        {
          updatedAt: template.updatedAt,
          publishedAt: template.publishedAt ?? null,
        },
        sent ? { content: undefined } : {},
        now
      ) ?? undefined,
    searchText: searchText(name, nextAlias),
  })
  if (contentChanged)
    await ctx.db.patch("templateDrafts", draft._id, {
      content: facts.components,
    })
  return null
}

export async function updateTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">,
  input: Input
) {
  if (isWhatsApp(template)) return updateWhatsAppTemplate(ctx, template, input)
  if (input.whatsapp !== undefined)
    throw new ConvexError("Only WhatsApp templates have WhatsApp settings")
  const id = template._id
  const draft = await findDraft(ctx, id)
  if (!draft) throw new ConvexError("Template not found")
  checkInput(input)
  const current: Draft = {
    name: template.name,
    subject: template.subject,
    preview: template.preview,
    from: template.from,
    replyTo: template.replyTo,
    html: draft.html,
    content: draft.content,
    text: draft.text,
    variableDefinitions: template.variableDefinitions,
    replyToAddresses: template.replyToAddresses,
  }
  const changes: Partial<Draft> = {}
  const offer = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (JSON.stringify(value ?? null) !== JSON.stringify(current[key] ?? null))
      changes[key] = value
  }
  /* A template is listed and deleted by its name, so it always has one. */
  if (input.name !== undefined)
    offer("name", input.name.trim() || UNTITLED_TEMPLATE)
  for (const key of ["subject", "preview", "html"] as const)
    if (input[key] !== undefined) offer(key, input[key])
  for (const key of ["from", "replyTo"] as const)
    if (input[key] !== undefined) offer(key, optionalText(input[key]))
  for (const key of [
    "text",
    "variableDefinitions",
    "replyToAddresses",
  ] as const)
    if (input[key] !== undefined) offer(key, input[key])
  if (input.content !== undefined) offer("content", input.content ?? undefined)
  if (input.replyTo !== undefined && input.replyToAddresses === undefined)
    offer(
      "replyToAddresses",
      input.replyTo.trim() ? [input.replyTo.trim()] : []
    )
  const alias = await chosenAlias(ctx, template, input.alias)
  if (alias === undefined && Object.keys(changes).length === 0) return null

  const next = { ...current, ...changes }
  const publishedAt = template.publishedAt ?? null
  const nextAlias = await aliasAfterEdit(ctx, template, alias, changes.name)
  const now = Math.max(Date.now(), template.updatedAt + 1)
  await patchRow(ctx, "templates", id, {
    name: next.name,
    alias: nextAlias,
    subject: next.subject,
    preview: next.preview,
    from: next.from,
    replyTo: next.replyTo,
    variables: draftVariables(next),
    variableDefinitions: next.variableDefinitions,
    replyToAddresses: next.replyToAddresses,
    updatedAt: now,
    version: (template.version ?? 0) + 1,
    variableMetadata: variableMetadata(
      template,
      resolvedVariables(next, next),
      now
    ),
    publishedAt:
      publishedAtAfterEdit(
        { updatedAt: template.updatedAt, publishedAt },
        // It only asks which fields changed, never their values.
        {
          ...changes,
          ...(["text", "variableDefinitions", "replyToAddresses"].some(
            (key) => key in changes
          )
            ? { html: next.html }
            : {}),
        } as Partial<EmailTemplate>,
        now
      ) ?? undefined,
    searchText: searchText(next.name, nextAlias),
  })
  if ("html" in changes || "content" in changes || "text" in changes)
    await ctx.db.patch("templateDrafts", draft._id, {
      html: next.html,
      text: next.text,
      content: next.content,
    })
  return null
}

export const SUBMIT_TO_META =
  "WhatsApp templates are published by submitting them to Meta"

export async function publishTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">
) {
  if (isWhatsApp(template)) throw new ConvexError(SUBMIT_TO_META)
  const id = template._id
  const draft = await findDraft(ctx, id)
  if (!draft?.html.trim())
    throw new ConvexError("Add content to this template before publishing")
  const now = Math.max(Date.now(), template.updatedAt + 1)
  const version = {
    templateId: id,
    organizationId: template.organizationId,
    subject: template.subject,
    preview: template.preview,
    html: draft.html,
    text: draft.text,
    from: template.from,
    replyTo: template.replyTo,
    variables: resolvedVariables(template, draft),
    replyToAddresses: template.replyToAddresses,
    publishedAt: now,
  }
  const live = await findPublished(ctx, id)
  if (live) await ctx.db.replace("publishedTemplates", live._id, version)
  else await ctx.db.insert("publishedTemplates", version)
  await patchRow(ctx, "templates", id, {
    status: "published",
    updatedAt: now,
    publishedAt: now,
  })
  return null
}

export async function duplicateTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">
) {
  const id = template._id
  const draft = await findDraft(ctx, id)
  if (isWhatsApp(template) && template.whatsapp)
    return insertWhatsAppTemplate(ctx, template.organizationId, {
      name: `${template.name}_copy`,
      content: draft?.content,
      whatsapp: await whatsappSettings(
        ctx,
        template.organizationId,
        {},
        template.whatsapp
      ),
      uniqueName: true,
    })
  return insertTemplate(ctx, template.organizationId, {
    // " copy" must not push a name at the limit past it.
    name: `${template.name} copy`.slice(0, TEXT_LIMITS.name[1]),
    subject: template.subject,
    preview: template.preview,
    from: template.from,
    replyTo: template.replyTo,
    html: draft?.html ?? "",
    text: draft?.text,
    variableDefinitions: template.variableDefinitions,
    replyToAddresses: template.replyToAddresses,
    content: draft?.content,
  })
}

export async function removeTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">
) {
  const id = template._id
  const draft = await findDraft(ctx, id)
  if (draft) await ctx.db.delete("templateDrafts", draft._id)
  const live = await findPublished(ctx, id)
  if (live) await ctx.db.delete("publishedTemplates", live._id)
  await deleteRow(ctx, "templates", id)
  return null
}

const RESERVED_VARIABLES = new Set([
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "RESEND_UNSUBSCRIBE_URL",
  "contact",
  "this",
])
export function validateVariables(
  variables: Infer<typeof templateVariableValue>[]
) {
  if (variables.length > MAX_TEMPLATE_VARIABLES)
    throw new ConvexError("A template can use at most 50 variables")
  const seen = new Set<string>()
  for (const variable of variables) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key) ||
      variable.key.length > 50 ||
      RESERVED_VARIABLES.has(variable.key) ||
      seen.has(variable.key)
    )
      throw new ConvexError(
        "Invalid, reserved or duplicate template variable name"
      )
    seen.add(variable.key)
    if (
      variable.fallback !== undefined &&
      (variable.fallback.length > 2000 ||
        (variable.type === "number" &&
          !Number.isFinite(Number(variable.fallback))))
    )
      throw new ConvexError("Invalid template variable fallback")
  }
}
export function resolvedVariables(
  template: Pick<
    Doc<"templates">,
    "subject" | "preview" | "variableDefinitions"
  >,
  draft: { html: string; text?: string }
) {
  const inferred = templateVariableDefaults({
    subject: template.subject,
    preview: template.preview,
    html: `${draft.html} ${draft.text ?? ""}`,
  })
  const definitions = new Map(
    inferred.map((variable) => [
      variable.key,
      variable as Infer<typeof templateVariableValue>,
    ])
  )
  for (const variable of template.variableDefinitions ?? [])
    definitions.set(variable.key, variable)
  return [...definitions.values()]
}

/** Metadata follows each variable across edits; removing and readding creates a new id. */
function variableMetadata(
  row: Doc<"templates">,
  variables: ReturnType<typeof resolvedVariables>,
  now: number
): NonNullable<Doc<"templates">["variableMetadata"]> {
  return variables.map((variable) => {
    const previous = row.variableMetadata?.find(
      (entry) => entry.key === variable.key
    )
    const type = variable.type ?? "string"
    return {
      key: variable.key,
      type,
      fallback: variable.fallback,
      id: previous?.id ?? `${row._id}:${variable.key}:${now}`,
      createdAt: previous?.createdAt ?? now,
      updatedAt:
        previous &&
        previous.type === type &&
        previous.fallback === variable.fallback
          ? previous.updatedAt
          : now,
    }
  })
}
