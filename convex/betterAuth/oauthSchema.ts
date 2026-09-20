// Storage schema derived from @better-auth/oauth-provider 1.6.15.
import { defineTable } from "convex/server"
import { v } from "convex/values"
export const oauthTables = {
  oauthClient: defineTable({
    clientId: v.string(),
    clientSecret: v.optional(v.union(v.null(), v.string())),
    disabled: v.optional(v.union(v.null(), v.boolean())),
    skipConsent: v.optional(v.union(v.null(), v.boolean())),
    enableEndSession: v.optional(v.union(v.null(), v.boolean())),
    subjectType: v.optional(v.union(v.null(), v.string())),
    scopes: v.optional(v.union(v.null(), v.array(v.string()))),
    userId: v.optional(v.union(v.null(), v.string())),
    createdAt: v.optional(v.union(v.null(), v.number())),
    updatedAt: v.optional(v.union(v.null(), v.number())),
    name: v.optional(v.union(v.null(), v.string())),
    uri: v.optional(v.union(v.null(), v.string())),
    icon: v.optional(v.union(v.null(), v.string())),
    contacts: v.optional(v.union(v.null(), v.array(v.string()))),
    tos: v.optional(v.union(v.null(), v.string())),
    policy: v.optional(v.union(v.null(), v.string())),
    softwareId: v.optional(v.union(v.null(), v.string())),
    softwareVersion: v.optional(v.union(v.null(), v.string())),
    softwareStatement: v.optional(v.union(v.null(), v.string())),
    redirectUris: v.array(v.string()),
    postLogoutRedirectUris: v.optional(v.union(v.null(), v.array(v.string()))),
    tokenEndpointAuthMethod: v.optional(v.union(v.null(), v.string())),
    grantTypes: v.optional(v.union(v.null(), v.array(v.string()))),
    responseTypes: v.optional(v.union(v.null(), v.array(v.string()))),
    public: v.optional(v.union(v.null(), v.boolean())),
    type: v.optional(v.union(v.null(), v.string())),
    requirePKCE: v.optional(v.union(v.null(), v.boolean())),
    referenceId: v.optional(v.union(v.null(), v.string())),
    metadata: v.optional(v.union(v.null(), v.string())),
  })
    .index("clientId", ["clientId"])
    .index("userId", ["userId"])
    .index("referenceId", ["referenceId"]),
  oauthRefreshToken: defineTable({
    token: v.string(),
    clientId: v.string(),
    sessionId: v.optional(v.union(v.null(), v.string())),
    userId: v.string(),
    referenceId: v.optional(v.union(v.null(), v.string())),
    expiresAt: v.number(),
    createdAt: v.number(),
    revoked: v.optional(v.union(v.null(), v.number())),
    authTime: v.optional(v.union(v.null(), v.number())),
    scopes: v.array(v.string()),
  })
    .index("token", ["token"])
    .index("clientId", ["clientId"])
    .index("sessionId", ["sessionId"])
    .index("userId", ["userId"])
    .index("referenceId", ["referenceId"]),
  oauthAccessToken: defineTable({
    token: v.string(),
    clientId: v.string(),
    sessionId: v.optional(v.union(v.null(), v.string())),
    userId: v.optional(v.union(v.null(), v.string())),
    referenceId: v.optional(v.union(v.null(), v.string())),
    refreshId: v.optional(v.union(v.null(), v.string())),
    expiresAt: v.number(),
    createdAt: v.number(),
    scopes: v.array(v.string()),
  })
    .index("token", ["token"])
    .index("clientId", ["clientId"])
    .index("sessionId", ["sessionId"])
    .index("userId", ["userId"])
    .index("referenceId", ["referenceId"])
    .index("refreshId", ["refreshId"]),
  oauthConsent: defineTable({
    clientId: v.string(),
    userId: v.optional(v.union(v.null(), v.string())),
    referenceId: v.optional(v.union(v.null(), v.string())),
    scopes: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("clientId", ["clientId"])
    .index("userId", ["userId"])
    .index("referenceId", ["referenceId"]),
  oauthJwks: defineTable({
    publicKey: v.string(),
    privateKey: v.string(),
    createdAt: v.number(),
    expiresAt: v.optional(v.union(v.null(), v.number())),
  }),
}
