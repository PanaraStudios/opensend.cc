import { defineTable } from "convex/server"
import { v } from "convex/values"

/** How a team connected a Meta business. */
export const metaConnectionMethodValue = v.union(
  v.literal("embedded_signup"),
  v.literal("manual_token"),
  v.literal("facebook_login")
)
export const metaConnectionStatusValue = v.union(
  v.literal("active"),
  /** Meta refused the token (Graph error 190); the team must reconnect. */
  v.literal("error"),
  v.literal("disconnected")
)
/** The Embedded Signup and Facebook Login for Business configurations. */
export const metaConfigIdsValue = v.object({
  whatsapp: v.optional(v.string()),
  facebookLogin: v.optional(v.string()),
})

/* One Meta developer app per installation, configured by the super admin
   like the AWS connection. Teams connect any number of Meta businesses to
   it. Secrets and tokens are encrypted with convex/secrets.ts. */
export const metaTables = {
  metaApps: defineTable({
    key: v.literal("metaApp"),
    appId: v.string(),
    /** The app's name, as Meta reported it at the last verification. */
    appName: v.optional(v.string()),
    encryptedAppSecret: v.string(),
    secretLast4: v.string(),
    /** The Graph API version every call uses, like `v25.0`. */
    graphVersion: v.string(),
    /** Meta echoes it when it verifies the webhook callback. */
    encryptedVerifyToken: v.string(),
    configIds: metaConfigIdsValue,
    verifiedAt: v.optional(v.number()),
    webhookSubscribedAt: v.optional(v.number()),
    /** The last verification or subscription failure. */
    error: v.optional(v.string()),
  }).index("by_key", ["key"]),
  /** One per team per Meta business. */
  metaConnections: defineTable({
    organizationId: v.string(),
    businessId: v.string(),
    businessName: v.string(),
    method: metaConnectionMethodValue,
    encryptedToken: v.string(),
    tokenLast4: v.string(),
    /** The token's granted permissions; Meta lists a handful. */
    scopes: v.array(v.string()),
    status: metaConnectionStatusValue,
    checkedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_businessId", ["businessId"]),
  /** A WhatsApp Business Account belongs to exactly one team. */
  whatsappBusinessAccounts: defineTable({
    organizationId: v.string(),
    wabaId: v.string(),
    connectionId: v.id("metaConnections"),
    name: v.optional(v.string()),
    subscribedAt: v.optional(v.number()),
    templatesSyncedAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_wabaId", ["wabaId"])
    .index("by_connectionId", ["connectionId"]),
  /** Raw webhook deliveries, stored before projection. */
  metaWebhookEvents: defineTable({
    /** The payload's `object`: `whatsapp_business_account`, `page`, `instagram`. */
    object: v.string(),
    /** SHA-256 of the raw body; Meta retries deliver the same bytes. */
    bodyHash: v.string(),
    /** The raw JSON body. */
    body: v.string(),
    receivedAt: v.number(),
    projectedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_bodyHash", ["bodyHash"])
    .index("by_receivedAt", ["receivedAt"]),
}
