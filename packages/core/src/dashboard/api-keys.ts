import type { ApiKey, ApiKeyPermission, Domain } from "./types"

export const API_KEY_PERMISSIONS: readonly ApiKeyPermission[] = [
  "full_access",
  "sending_access",
  "custom",
]

/** Sentinel for "no permission filter", shared by the select and the filter. */
export const ALL_PERMISSIONS = "all"

/** Sentinel for "not restricted to one domain", shared by the domain select. */
export const ALL_DOMAINS = "all"

export const ALL_DOMAINS_LABEL = "All domains"

/** A sending key can be pinned to one domain; anything else sends from all. */
export function apiKeyDomainLabel(
  domains: readonly Domain[],
  key: Pick<ApiKey, "domainId">
): string {
  if (!key.domainId) return ALL_DOMAINS_LABEL
  return (
    domains.find((domain) => domain.id === key.domainId)?.name ??
    "Removed domain (sending disabled)"
  )
}
