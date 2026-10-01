import type { Infer } from "convex/values"
import type { variableSource } from "../../convex/tables/variables"

/** Bare strings remain compatible with stored campaigns and SDK inputs. */
export type VariableSource = Infer<typeof variableSource>
export const CONTACT_VARIABLE_FIELDS = [
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
] as const
export function normalizeVariableSource(source: VariableSource) {
  return typeof source === "string" ? { value: source } : source
}
export type VariableContact = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  properties: Record<string, string>
}

export function variableSourcesError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return "Variables must be a mapping"
  const entries = Object.entries(value)
  if (entries.length > 100) return "At most 100 variables are supported"
  for (const [key, source] of entries) {
    if (!key || key.length > 128) return "Invalid variable name"
    if (typeof source === "string") {
      if (source.length > 4096) return "Variable value is too long"
      continue
    }
    if (!source || typeof source !== "object" || Array.isArray(source))
      return `Invalid source for ${key}`
    const s = source as Record<string, unknown>
    const kinds = ["contact", "property", "value"].filter((k) => k in s)
    if (
      kinds.length !== 1 ||
      Object.keys(s).some((k) => ![...kinds, "fallback"].includes(k))
    )
      return `Invalid source for ${key}`
    const kind = kinds[0]
    if (typeof s[kind] !== "string" || (s[kind] as string).length > 4096)
      return `Invalid source for ${key}`
    if (
      kind === "contact" &&
      !CONTACT_VARIABLE_FIELDS.some((field) => field.value === s.contact)
    )
      return `Invalid contact field for ${key}`
    if (kind === "property" && !/^[A-Za-z0-9_]+$/.test(s.property as string))
      return `Invalid property for ${key}`
    if (
      s.fallback !== undefined &&
      (typeof s.fallback !== "string" || s.fallback.length > 4096)
    )
      return `Invalid fallback for ${key}`
  }
  return null
}

export function resolveVariables(
  variables: Readonly<Record<string, VariableSource>>,
  contact: VariableContact,
  propertyFallbacks: Readonly<Record<string, string>> = {}
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, source]) => {
      const normalized = normalizeVariableSource(source)
      const value =
        "contact" in normalized
          ? contact[normalized.contact]
          : "property" in normalized
            ? contact.properties[normalized.property] ||
              propertyFallbacks[normalized.property]
            : normalized.value
      return [key, value || normalized.fallback || ""]
    })
  )
}
