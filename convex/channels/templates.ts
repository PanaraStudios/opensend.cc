import { ConvexError } from "convex/values"
import type { MutationCtx } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { teamTemplate, findPublished } from "../templates"
import { object, string } from "../../lib/meta/webhooks"
import {
  fillLocalTemplate,
  localTemplate,
} from "../../lib/meta/local-templates"

/** Sends use only the published copy, and only in its own team and channel. */
export async function resolveLocalTemplate(
  ctx: MutationCtx,
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
