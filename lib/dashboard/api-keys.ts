import { matchesNeedle } from "./search"
import type { ApiKey, ApiKeyPermission, ApiLog, Domain } from "./types"

export const API_KEY_PERMISSIONS: readonly ApiKeyPermission[] = [
  "full_access",
  "sending_access",
]

/** Sentinel for "no permission filter", shared by the select and the filter. */
export const ALL_PERMISSIONS = "all"

/** Sentinel for "not restricted to one domain", shared by the domain select. */
export const ALL_DOMAINS = "all"

export const ALL_DOMAINS_LABEL = "All domains"

/** Search matches the name and the visible part of the token, the two things
    a reader can actually see in the table. */
export function filterApiKeys(
  keys: readonly ApiKey[],
  options: { needle: string; permission: string }
): ApiKey[] {
  return keys.filter(
    (key) =>
      matchesNeedle(options.needle, key.name, key.tokenPrefix) &&
      (options.permission === ALL_PERMISSIONS ||
        key.permission === options.permission)
  )
}

/** Requests signed with this key, newest first as the log list stores them. */
export function apiKeyLogs(logs: readonly ApiLog[], keyId: string): ApiLog[] {
  return logs.filter((log) => log.apiKeyId === keyId)
}

/** A sending key can be pinned to one domain; anything else sends from all. */
export function apiKeyDomainLabel(
  domains: readonly Domain[],
  key: Pick<ApiKey, "domainId">
): string {
  if (!key.domainId) return ALL_DOMAINS_LABEL
  return (
    domains.find((domain) => domain.id === key.domainId)?.name ??
    ALL_DOMAINS_LABEL
  )
}
