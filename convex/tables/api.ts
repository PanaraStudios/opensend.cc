import { defineTable } from "convex/server"
import { v } from "convex/values"

export const apiKeyPermissionValue = v.union(
  v.literal("full_access"),
  v.literal("sending_access")
)
export const logSourceValue = v.union(
  v.literal("api"),
  v.literal("smtp"),
  v.literal("dashboard")
)
export const statusClassValue = v.union(
  v.literal("2xx"),
  v.literal("3xx"),
  v.literal("4xx"),
  v.literal("5xx")
)
export const httpMethodValue = v.union(
  v.literal("GET"),
  v.literal("POST"),
  v.literal("PATCH"),
  v.literal("DELETE")
)

export const apiTables = {
  /* The key document is read on every request, so it holds only what
     changes when a person edits the key. */
  apiKeys: defineTable({
    organizationId: v.string(),
    name: v.string(),
    /** SHA-256 of the token; the token itself is never stored. */
    tokenHash: v.string(),
    tokenPrefix: v.string(),
    tokenLast4: v.string(),
    permission: apiKeyPermissionValue,
    /** Only for sending access: the one domain it may send from. */
    domainId: v.optional(v.id("domains")),
    createdBy: v.object({ userId: v.optional(v.string()), name: v.string() }),
    /** The name and visible token prefix, for the dashboard's search. */
    search: v.string(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_permission", ["organizationId", "permission"])
    .searchIndex("search_keys", {
      searchField: "search",
      filterFields: ["organizationId", "permission"],
    }),
  /** High-churn usage, kept off the key; written at most once a minute. */
  apiKeyUsage: defineTable({
    apiKeyId: v.id("apiKeys"),
    lastUsedAt: v.number(),
  }).index("by_apiKeyId", ["apiKeyId"]),
  /** `Idempotency-Key` replays, kept for 24 hours. */
  apiIdempotency: defineTable({
    organizationId: v.string(),
    key: v.string(),
    /** SHA-256 of method, path and body: a reused key must match it. */
    requestHash: v.string(),
    response: v.optional(v.object({ status: v.number(), body: v.string() })),
    expiresAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_key", ["organizationId", "key"])
    .index("by_expiresAt", ["expiresAt"]),
  /* One row per request. Lists read these small rows; headers and bodies
     live in `apiLogBodies`, read only by the detail view. */
  apiLogs: defineTable({
    organizationId: v.string(),
    method: httpMethodValue,
    path: v.string(),
    status: v.number(),
    statusClass: statusClassValue,
    durationMs: v.number(),
    userAgent: v.string(),
    source: logSourceValue,
    apiKeyId: v.optional(v.id("apiKeys")),
    /** Set instead of `apiKeyId` for a request signed with an OAuth token. */
    oauthGrantId: v.optional(v.string()),
    /** Linked by the sending lane once emails are real. */
    emailId: v.optional(v.string()),
    /** "POST /emails 200", for the dashboard's search box. */
    summary: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_userAgent", ["organizationId", "userAgent"])
    .index("by_organizationId_and_statusClass", [
      "organizationId",
      "statusClass",
    ])
    .index("by_organizationId_and_source", ["organizationId", "source"])
    .index("by_organizationId_and_statusClass_and_source", [
      "organizationId",
      "statusClass",
      "source",
    ])
    .index("by_organizationId_and_emailId", ["organizationId", "emailId"])
    .index("by_organizationId_and_apiKeyId", ["organizationId", "apiKeyId"])
    .searchIndex("search_summary", {
      searchField: "summary",
      filterFields: [
        "organizationId",
        "statusClass",
        "source",
        "userAgent",
        "emailId",
        "apiKeyId",
      ],
    }),
  apiLogBodies: defineTable({
    logId: v.id("apiLogs"),
    /** Authorization and cookies are redacted before they are stored. */
    requestHeaders: v.array(v.object({ name: v.string(), value: v.string() })),
    requestBody: v.optional(v.string()),
    responseBody: v.optional(v.string()),
    /** Set when a body was cut to the stored size. */
    truncated: v.optional(v.boolean()),
  }).index("by_logId", ["logId"]),
}
