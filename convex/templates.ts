import { includeSelected, OPTION_LIMIT } from "../lib/dashboard/options"
import { selectedOption } from "./lists"
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
import { templateStatusValue, templateVariableValue } from "./tables/templates"
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
}
export type Input = Partial<
  Record<keyof typeof TEXT_LIMITS | "html" | "text", string> & {
    content: unknown
    variableDefinitions: Infer<typeof templateVariableValue>[]
    replyToAddresses: string[]
  }
>
type Draft = Pick<EmailTemplate, "name" | "subject" | "preview" | "html"> & {
  content?: unknown
  text?: string
  variableDefinitions?: Infer<typeof templateVariableValue>[]
  replyToAddresses?: string[]
  from?: string
  replyTo?: string
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
    searchText: searchText(name, alias),
  })
  await ctx.db.insert("templateDrafts", {
    templateId: id,
    html: draft.html,
    text: draft.text,
    ...(draft.content != null ? { content: draft.content } : {}),
  })
  return id
}

const listItem = schema.doc("templates").extend({ html: v.string() })

const templateFilters = {
  organizationId: v.string(),
  /** Part of the name or alias, as typed. */
  search: v.optional(v.string()),
  status: v.optional(templateStatusValue),
}

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
    const rows = args.status
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
      (row) => matches(row.name, row.alias),
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
    if (args.search?.trim()) return { total: null }
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
  handler: async (ctx, { organizationId }) => {
    await requireTeam(ctx, organizationId)
    const first = await ctx.db
      .query("templates")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", organizationId)
      )
      .first()
    return first !== null
  },
})

/** The team's newest templates, without their bodies: for pickers on other
    screens, which re-render on every autosave. */
export const options = query({
  args: {
    organizationId: v.string(),
    search: v.optional(v.string()),
    selectedId: v.optional(v.id("templates")),
  },
  returns: v.array(schema.doc("templates")),
  handler: async (ctx, { organizationId, search, selectedId }) => {
    await requireTeam(ctx, organizationId, "read")
    const rows = search?.trim()
      ? await ctx.db
          .query("templates")
          .withSearchIndex("search_searchText", (q) =>
            q
              .search("searchText", search.trim())
              .eq("organizationId", organizationId)
          )
          .take(OPTION_LIMIT)
      : await ctx.db
          .query("templates")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", organizationId)
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
    const normalized = ctx.db.normalizeId("templates", id)
    const template = normalized
      ? await ctx.db.get("templates", normalized)
      : null
    if (!template || template.organizationId !== organizationId) return null
    const draft = await findDraft(ctx, template._id)
    return { template, html: draft?.html ?? "", content: draft?.content }
  },
})

export const create = mutation({
  args: { organizationId: v.string(), name: v.string(), ...draftFields },
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

export const remove = mutation({
  args: { id: v.id("templates") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const template = await writable(ctx, id)
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
  if (!template || template.organizationId !== organizationId) return null
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

export async function updateTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">,
  input: Input
) {
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
  const alias = input.alias?.trim()
  if (alias !== undefined && alias !== template.alias) {
    const error = templateAliasError(
      alias,
      (await aliasOwner(ctx, template.organizationId, alias)) ? [{ alias }] : []
    )
    if (error) throw new ConvexError(error)
  }
  const aliasChanged = alias !== undefined && alias !== template.alias
  if (!aliasChanged && Object.keys(changes).length === 0) return null

  const next = { ...current, ...changes }
  const publishedAt = template.publishedAt ?? null
  const nextAlias = aliasChanged
    ? alias
    : changes.name === undefined || publishedAt !== null
      ? template.alias
      : renamedTemplateAlias(
          { id, name: template.name, alias: template.alias, publishedAt },
          changes.name,
          await aliasesNear(ctx, template.organizationId, changes.name)
        )
  if (nextAlias !== template.alias && !aliasChanged)
    await checkFree(ctx, template.organizationId, nextAlias)
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

export async function publishTemplate(
  ctx: MutationCtx,
  template: Doc<"templates">
) {
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
