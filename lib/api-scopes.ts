/** Shared REST, OAuth and dashboard permission catalog. Write includes read. */
export const API_RESOURCES = [
  {
    id: "emails",
    label: "Emails",
    group: "Messaging",
    description:
      "Send, list, retrieve, cancel and update emails, including received email.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    group: "Messaging",
    description: "Messages, media, phone numbers and conversations.",
  },
  {
    id: "messenger",
    label: "Messenger",
    group: "Messaging",
    description: "Messages, media, pages and conversations.",
  },
  {
    id: "instagram",
    label: "Instagram",
    group: "Messaging",
    description: "Messages, media, accounts and conversations.",
  },
  {
    id: "media",
    label: "Media",
    group: "Messaging",
    description: "Direct file uploads for messaging and imports.",
  },
  {
    id: "contacts",
    label: "Contacts",
    group: "Audience",
    description: "Contacts, contact properties, imports and suppressions.",
  },
  {
    id: "segments",
    label: "Segments",
    group: "Audience",
    description: "Segments, audiences and their contacts.",
  },
  {
    id: "topics",
    label: "Topics",
    group: "Audience",
    description: "Topics and subscriptions.",
  },
  {
    id: "templates",
    label: "Templates",
    group: "Content & campaigns",
    description: "Create, manage and publish templates.",
  },
  {
    id: "broadcasts",
    label: "Broadcasts",
    group: "Content & campaigns",
    description: "Create, manage and send broadcasts.",
  },
  {
    id: "automations",
    label: "Automations",
    group: "Content & campaigns",
    description: "Automations and their runs.",
  },
  {
    id: "events",
    label: "Events",
    group: "Content & campaigns",
    description: "Create, manage and send events.",
  },
  {
    id: "domains",
    label: "Domains",
    group: "Setup",
    description: "Domains, claims and verification.",
  },
  {
    id: "webhooks",
    label: "Webhooks",
    group: "Setup",
    description: "Webhook endpoints and deliveries.",
  },
  {
    id: "logs",
    label: "Logs",
    group: "Setup",
    description: "API request logs.",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    group: "Calling",
    description: "Manage and search reusable knowledge bases.",
  },
  {
    id: "bot_tools",
    label: "Bot tools",
    group: "Calling",
    description: "Manage signed webhook tools.",
  },
  {
    id: "calling",
    label: "Calling",
    group: "Calling",
    description: "Manage voice calls and phone routing.",
  },
  {
    id: "ivrs",
    label: "IVRs",
    group: "Calling",
    description: "Manage call menus, prompts and routing.",
  },
  {
    id: "voice_bots",
    label: "Voice bots",
    group: "Calling",
    description: "Manage voice bots and their behavior.",
  },
  {
    id: "voice_providers",
    label: "Voice providers",
    group: "Calling",
    description: "Manage encrypted AI provider keys.",
  },
] as const
export type ApiResource = (typeof API_RESOURCES)[number]["id"]
export type ScopeAccess = "read" | "write"
export type ApiScope = `${ApiResource}:${ScopeAccess}`
export type RequiredScope =
  { resource: ApiResource; access: ScopeAccess } | "full_access"
export const API_SCOPES: readonly ApiScope[] = API_RESOURCES.flatMap(
  ({ id }) => [`${id}:read` as const, `${id}:write` as const]
)

/** Reject malformed/unknown scopes and normalize duplicates and implied reads. */
export function parseScopes(value: unknown): ApiScope[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (s): s is ApiScope =>
        typeof s === "string" && API_SCOPES.includes(s as ApiScope)
    )
  )
    throw new Error(
      "Scopes must be an array of supported resource:read or resource:write permissions"
    )
  const unique = new Set(value)
  return API_SCOPES.filter(
    (scope) =>
      unique.has(scope) &&
      !(
        scope.endsWith(":read") &&
        unique.has(scope.replace(/:read$/, ":write") as ApiScope)
      )
  )
}
export function scopeAllows(
  scopes: readonly string[],
  resource: ApiResource,
  access: ScopeAccess
): boolean {
  const previous =
    resource === "calling"
      ? "whatsapp"
      : resource === "voice_providers"
        ? "voice_bots"
        : undefined
  return (
    (previous !== undefined && scopeAllows(scopes, previous, access)) ||
    scopes.includes(`${resource}:write`) ||
    (access === "read" && scopes.includes(`${resource}:read`))
  )
}
export function scopeName(scope: RequiredScope): ApiScope | "full_access" {
  return scope === "full_access" ? scope : `${scope.resource}:${scope.access}`
}
/** Permission text shared by the base and enriched REST documentation. */
export function scopeDescription(scope: ApiScope | "full_access"): string {
  if (scope === "full_access") return "Requires full_access access."
  if (!API_SCOPES.includes(scope))
    throw new Error(`Unknown API scope: ${scope}`)
  return `Requires ${scope} or full_access access (write includes read).`
}
export function scopeLabel(scope: string): string {
  const [id, access] = scope.split(":")
  const resource = API_RESOURCES.find((r) => r.id === id)
  return resource
    ? `${resource.label}: ${access === "write" ? "Read and write" : "Read"}`
    : scope
}
