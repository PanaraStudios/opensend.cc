import { usedVariables } from "./email-variables"
import { slugify, uniqueSlug } from "./slug"
import type { EmailTemplate } from "./types"

export const UNTITLED_TEMPLATE = "Untitled Template"

const ALIAS_FALLBACK = "template"

export function uniqueTemplateAlias(
  name: string,
  templates: readonly Pick<EmailTemplate, "alias">[]
): string {
  return uniqueSlug(
    name,
    templates.map((item) => item.alias),
    ALIAS_FALLBACK
  )
}

/** True while the alias is still the one made from the name: its slug, or
    that slug numbered because another template held it at the time. */
function isAutomaticAlias(item: Pick<EmailTemplate, "name" | "alias">) {
  const base = slugify(item.name) || ALIAS_FALLBACK
  return (
    item.alias === base ||
    (item.alias.startsWith(`${base}-`) &&
      /^\d+$/.test(item.alias.slice(base.length + 1)))
  )
}

/** The alias after a rename. It follows the name until the template has been
    published or the alias was chosen by hand: from then on callers may be
    sending by it, and it stays put. */
export function renamedTemplateAlias(
  item: Pick<EmailTemplate, "id" | "name" | "alias" | "publishedAt">,
  name: string | undefined,
  templates: readonly Pick<EmailTemplate, "id" | "alias">[]
): string {
  if (name === undefined || item.publishedAt !== null) return item.alias
  if (!isAutomaticAlias(item)) return item.alias
  return uniqueTemplateAlias(
    name,
    templates.filter((other) => other.id !== item.id)
  )
}

/** Every variable a send has to fill: the body's, and the envelope's. */
export function templateVariables(
  item: Pick<EmailTemplate, "subject" | "preview" | "html">
): string[] {
  return usedVariables(`${item.subject}\n${item.preview}\n${item.html}`)
}

/** Why an alias cannot be used, or null when it can. */
export function templateAliasError(
  alias: string,
  others: readonly Pick<EmailTemplate, "alias">[]
): string | null {
  if (!alias) return "Enter an alias"
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(alias)) {
    return "Use lowercase letters, numbers, dashes and underscores"
  }
  if (others.some((item) => item.alias === alias)) {
    return "Another template already uses this alias"
  }
  return null
}

/** What publishing would do right now, or null when the live version is
    already this one. A published template edited since still sends the
    version before. */
export function templatePublishLabel(
  item: Pick<EmailTemplate, "status" | "updatedAt" | "publishedAt">
): "Publish" | "Publish changes" | null {
  if (item.status === "draft") return "Publish"
  return item.publishedAt !== null && item.updatedAt > item.publishedAt
    ? "Publish changes"
    : null
}

const SENT_FIELDS = [
  "subject",
  "preview",
  "html",
  "content",
  "from",
  "replyTo",
] as const

/** `publishedAt` after an edit at `now`. A rename or a new alias changes
    nothing a recipient gets, so a template that was live stays live. */
export function publishedAtAfterEdit(
  item: Pick<EmailTemplate, "updatedAt" | "publishedAt">,
  patch: Partial<EmailTemplate>,
  now: number
): number | null {
  const live = item.publishedAt !== null && item.updatedAt <= item.publishedAt
  const sent = SENT_FIELDS.some((field) => field in patch)
  return live && !sent ? now : item.publishedAt
}

/** Backfill for records persisted before templates opened in the editor. */
export function normalizeTemplates(
  templates: readonly EmailTemplate[]
): EmailTemplate[] {
  const out: EmailTemplate[] = []
  for (const item of templates) {
    out.push({
      ...item,
      alias: item.alias || uniqueTemplateAlias(item.name, out),
      preview: item.preview ?? "",
      publishedAt:
        item.publishedAt ??
        (item.status === "published" ? item.updatedAt : null),
    })
  }
  return out
}

export type TemplateInput = Pick<EmailTemplate, "name" | "subject"> &
  Partial<
    Pick<EmailTemplate, "preview" | "html" | "content" | "from" | "replyTo">
  >
