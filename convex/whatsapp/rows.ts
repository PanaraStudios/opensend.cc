import { ConvexError, type Infer } from "convex/values"
import type { QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import type { whatsappTemplateValue } from "../tables/templates"
import {
  DEFAULT_TEMPLATE_LANGUAGE,
  EDITABLE_STATUSES,
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIMITS,
  componentsFromForm,
  componentsParameterFormat,
  EMPTY_TEMPLATE_FORM,
  isTemplateLanguage,
  templateNameFrom,
  templateVariables,
  type TemplateComponent,
} from "../../lib/meta/templates"

/* Row rules for WhatsApp templates, shared by the templates module, the
   Meta sync and the REST API. No functions are registered here. */

export type WhatsAppTemplate = Infer<typeof whatsappTemplateValue>
export type WhatsAppSettings = Pick<
  WhatsAppTemplate,
  "wabaId" | "language" | "category"
>

export const WHATSAPP_ACCOUNT_MISSING =
  "Connect a WhatsApp Business Account on the Channels page first"
export const TEMPLATE_NAME_TAKEN =
  "A WhatsApp template with this name and language already exists"
export const SUBMITTED_LOCKED =
  "Meta does not allow changing the name, language or account of a submitted template"

export const isWhatsApp = (template: Pick<Doc<"templates">, "channel">) =>
  template.channel === "whatsapp"

/** The team's WhatsApp Business Accounts, oldest first. */
export const teamWabas = (ctx: QueryCtx, organizationId: string) =>
  ctx.db
    .query("whatsappBusinessAccounts")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId)
    )
    .take(100)

/** The team's templates with a name and language, on any WABA. */
export const namesakes = (
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  language: string
) =>
  ctx.db
    .query("templates")
    .withIndex("by_organizationId_and_name_and_whatsapp_language", (q) =>
      q
        .eq("organizationId", organizationId)
        .eq("name", name)
        .eq("whatsapp.language", language)
    )
    .take(100)

/** Meta's rule: one template per WABA, name and language. */
export async function assertNameFree(
  ctx: QueryCtx,
  organizationId: string,
  target: { name: string; wabaId: string; language: string },
  except?: Id<"templates">
) {
  const rows = await namesakes(
    ctx,
    organizationId,
    target.name,
    target.language
  )
  if (
    rows.some(
      (row) => row._id !== except && row.whatsapp?.wabaId === target.wabaId
    )
  )
    throw new ConvexError(TEMPLATE_NAME_TAKEN)
}

/** `name`, or `name_2`, `name_3`… when a template already holds it. */
export async function freeTemplateName(
  ctx: QueryCtx,
  organizationId: string,
  name: string,
  target: { wabaId: string; language: string }
) {
  const base = templateNameFrom(name).slice(0, TEMPLATE_LIMITS.name - 4)
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}_${n}`
    const rows = await namesakes(
      ctx,
      organizationId,
      candidate,
      target.language
    )
    if (!rows.some((row) => row.whatsapp?.wabaId === target.wabaId))
      return candidate
  }
  throw new ConvexError(TEMPLATE_NAME_TAKEN)
}

/** The settings a change asks for, checked against the team and Meta. A
    new template without a WABA takes the team's first one. */
export async function whatsappSettings(
  ctx: QueryCtx,
  organizationId: string,
  input: Partial<WhatsAppSettings>,
  current?: WhatsAppTemplate
): Promise<WhatsAppSettings> {
  const wabaId = input.wabaId ?? current?.wabaId
  const wabas = await teamWabas(ctx, organizationId)
  const waba = wabaId ? wabas.find((row) => row.wabaId === wabaId) : wabas[0]
  // A disconnected WABA stays on its templates; only a new one must be live.
  if (!waba && (!current || input.wabaId !== undefined))
    throw new ConvexError(
      wabaId ? "WhatsApp Business Account not found" : WHATSAPP_ACCOUNT_MISSING
    )
  const language =
    input.language ?? current?.language ?? DEFAULT_TEMPLATE_LANGUAGE
  if (!isTemplateLanguage(language))
    throw new ConvexError("Choose a supported template language")
  const category = input.category ?? current?.category ?? "MARKETING"
  if (!TEMPLATE_CATEGORIES.includes(category))
    throw new ConvexError("Choose a template category")
  return { wabaId: waba?.wabaId ?? wabaId!, language, category }
}

/** Refuses what Meta cannot change once a template is submitted. */
export function assertChangeAllowed(
  current: WhatsAppTemplate,
  next: WhatsAppSettings,
  renamed: boolean
) {
  if (!current.metaTemplateId) return
  if (
    renamed ||
    next.wabaId !== current.wabaId ||
    next.language !== current.language
  )
    throw new ConvexError(SUBMITTED_LOCKED)
  if (next.category !== current.category && current.metaStatus === "APPROVED")
    throw new ConvexError(
      "Meta does not allow changing the category of an approved template"
    )
}

/** Whether Meta takes an edit of the template now. */
export const editableAtMeta = (template: WhatsAppTemplate) =>
  !template.metaTemplateId ||
  (template.metaStatus !== undefined &&
    EDITABLE_STATUSES.includes(template.metaStatus))

/** Stored components, or none: the draft holds JSON from anywhere. */
export function storedComponents(content: unknown): TemplateComponent[] {
  if (!Array.isArray(content)) return []
  return content.filter(
    (item): item is TemplateComponent =>
      !!item &&
      typeof item === "object" &&
      typeof (item as { type?: unknown }).type === "string"
  )
}

/** A new template's components: an empty body. */
export const emptyComponents = () => componentsFromForm(EMPTY_TEMPLATE_FORM)

/** The parameter format and variable keys a draft's components imply. */
export function componentFacts(content: unknown) {
  const components = storedComponents(content)
  const parameterFormat = componentsParameterFormat(components)
  return {
    components,
    parameterFormat,
    variables: templateVariables(components, parameterFormat).map(
      (variable) => variable.key
    ),
  }
}
