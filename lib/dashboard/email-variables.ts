import type { ContactProperty } from "./types"

/* Merge tags in an email: `{{{contact.first_name|there}}}`. They travel as
   plain text through the editor and the exported HTML, and are filled in per
   recipient at send time. */

export type EmailVariable = {
  name: string
  label: string
  fallback: string
  group: "contact" | "system"
}

/* `{{{name}}}` or `{{{name|fallback}}}`. Contact fields are dotted
   (`contact.first_name`); the seeded templates' `{{{FIRST_NAME}}}` style still
   parses, so old copy keeps working. */
const VARIABLE_PATTERN = /\{\{\{\s*([A-Za-z0-9_.]+)\s*(?:\|([^}]*))?\}\}\}/g

export function formatVariable(name: string, fallback = ""): string {
  return fallback ? `{{{${name}|${fallback}}}}` : `{{{${name}}}}`
}

export function parseVariables(
  source: string
): { name: string; fallback: string }[] {
  const out: { name: string; fallback: string }[] = []
  for (const match of source.matchAll(VARIABLE_PATTERN)) {
    out.push({ name: match[1]!, fallback: (match[2] ?? "").trim() })
  }
  return out
}

export const UNSUBSCRIBE_VARIABLE_NAME = "OPENSEND_UNSUBSCRIBE_URL"

/** The opt-out link's destination, filled in per recipient. */
export const UNSUBSCRIBE_VARIABLE = formatVariable(UNSUBSCRIBE_VARIABLE_NAME)

export const BUILT_IN_VARIABLES: EmailVariable[] = [
  {
    name: "contact.first_name",
    label: "First name",
    fallback: "there",
    group: "contact",
  },
  {
    name: "contact.last_name",
    label: "Last name",
    fallback: "",
    group: "contact",
  },
  { name: "contact.email", label: "Email", fallback: "", group: "contact" },
  {
    name: UNSUBSCRIBE_VARIABLE_NAME,
    label: "Unsubscribe URL",
    fallback: "",
    group: "system",
  },
]

/** Built-ins plus every contact property defined in the workspace. */
export function availableVariables(
  properties: readonly ContactProperty[]
): EmailVariable[] {
  const seen = new Set(BUILT_IN_VARIABLES.map((variable) => variable.name))
  const extra: EmailVariable[] = []
  for (const property of properties) {
    const name = `contact.${property.key}`
    if (!property.key || seen.has(name)) continue
    seen.add(name)
    extra.push({
      name,
      label: property.name || property.key,
      fallback: property.fallbackValue ?? "",
      group: "contact",
    })
  }
  return [...BUILT_IN_VARIABLES, ...extra]
}

/** Names of the variables a piece of email markup uses. */
export function usedVariables(source: string): string[] {
  return [...new Set(parseVariables(source).map((variable) => variable.name))]
}

export function hasUnsubscribeLink(source: string): boolean {
  return source.includes(UNSUBSCRIBE_VARIABLE_NAME)
}
