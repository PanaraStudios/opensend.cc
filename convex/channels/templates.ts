import { ConvexError } from "convex/values"
import type { QueryCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { teamTemplate, findPublished } from "../templates"
import { object, string } from "../../lib/meta/webhooks"
import { array } from "../../lib/meta/parse"
import { namesakes, isWhatsApp } from "../whatsapp/rows"
import {
  renderTemplate,
  storedComponents,
  type TemplateComponent,
  type RenderedTemplate,
} from "../../lib/meta/templates"
import {
  fillLocalTemplate,
  localTemplate,
} from "../../lib/meta/local-templates"

/** Sends use only the published copy, and only in its own team and channel. */
export async function localTemplateDefinition(
  ctx: QueryCtx,
  organizationId: string,
  channel: Doc<"channelAccounts">["channel"],
  ref: unknown
) {
  const reference = typeof ref === "string" ? { id: ref } : object(ref)
  const key = string(reference.id) || string(reference.alias)
  if (!key) throw new ConvexError("Specify a template id or alias")
  const template = await teamTemplate(ctx, organizationId, key, channel)
  if (!template) throw new ConvexError("Template not found")
  const published = await findPublished(ctx, template._id)
  if (!published || template.status !== "published")
    throw new ConvexError("Publish this template before sending it")
  return { template, published }
}

export async function resolveLocalTemplate(
  ctx: QueryCtx,
  organizationId: string,
  channel: Doc<"channelAccounts">["channel"],
  ref: unknown
) {
  const reference = typeof ref === "string" ? { id: ref } : object(ref)
  const { template, published } = await localTemplateDefinition(
    ctx,
    organizationId,
    channel,
    reference
  )
  const given =
    reference.variables === undefined ? {} : object(reference.variables)
  if (
    reference.variables !== undefined &&
    (reference.variables === null ||
      typeof reference.variables !== "object" ||
      Array.isArray(reference.variables))
  )
    throw new ConvexError("Template variables must be an object")
  const values: Record<string, string> = {}
  for (const variable of published.variables) {
    const value = Object.hasOwn(given, variable.key)
      ? given[variable.key]
      : variable.fallback
    if (value === undefined)
      throw new ConvexError(`Missing template variables: ${variable.key}`)
    if (
      typeof value !== "string" &&
      !(typeof value === "number" && Number.isFinite(value))
    )
      throw new ConvexError(`Invalid template variable: ${variable.key}`)
    values[variable.key] = String(value)
  }
  return {
    id: template._id,
    body: fillLocalTemplate(localTemplate(published.components), values),
  }
}

/** Search scans reserve content + published bodies and historical name lookups.
 * These reads happen after pagination, so header bytes alone are insufficient.
 * Keep headroom for account/identity rows and up to 100 template metadata rows. */
export const TEMPLATE_HYDRATION_BYTES = 4 * 1024 * 1024

export type TemplatePageCache = Map<string, Promise<TemplateComponent[] | null>>

/** Display lookups use the published copy even if Meta later paused it.
 * A cache belongs to one query page, never across teams or transactions. */
export async function whatsappTemplateComponents(
  ctx: QueryCtx,
  organizationId: string,
  wabaId: string | undefined,
  ref: Record<string, unknown>,
  cache: TemplatePageCache = new Map()
): Promise<TemplateComponent[] | null> {
  const name = string(ref.name)
  const language =
    typeof ref.language === "string"
      ? ref.language
      : string(object(ref.language).code)
  if (!wabaId || !name || !language) return null
  const key = JSON.stringify([organizationId, wabaId, name, language])
  let lookup = cache.get(key)
  if (!lookup) {
    lookup = (async () => {
      const rows = await namesakes(ctx, organizationId, name, language)
      for (const row of rows) {
        if (!isWhatsApp(row) || row.whatsapp?.wabaId !== wabaId) continue
        const published = await findPublished(ctx, row._id)
        if (
          published?.organizationId === organizationId &&
          published.components
        )
          return storedComponents(published.components)
      }
      return null
    })()
    cache.set(key, lookup)
  }
  return lookup
}

/** Shared Inbox/detail projection: snapshots win; historical rows hydrate
 * on the server, while Page messages already hold the sent text/replies. */
export async function renderedChannelTemplate(
  ctx: QueryCtx,
  message: Doc<"channelMessages">,
  content: Doc<"channelMessageContents"> | null,
  account: Doc<"channelAccounts"> | null,
  cache: TemplatePageCache = new Map()
): Promise<RenderedTemplate | null> {
  if (message.type !== "template") return null
  if (content?.rendered) return content.rendered
  const payload = object(JSON.parse(content?.payload ?? "{}"))
  if (message.channel !== "whatsapp") {
    const page = object(payload.message)
    return {
      body: string(page.text) || message.preview,
      buttons: array(page.quick_replies).map((raw) => ({
        type: "QUICK_REPLY",
        text: string(object(raw).title),
      })),
    }
  }
  const ref = object(payload.template)
  const components =
    account?.organizationId === message.organizationId
      ? await whatsappTemplateComponents(
          ctx,
          message.organizationId,
          account.wabaId,
          ref,
          cache
        )
      : null
  const preview = message.preview.trim()
  const fallback =
    preview &&
    preview !== string(ref.name) &&
    !/^\[template:.*\]$|^Template: /i.test(preview)
      ? preview
      : "Template content unavailable"
  return components
    ? renderTemplate(components, ref.components)
    : {
        body: fallback,
        buttons: [],
      }
}
