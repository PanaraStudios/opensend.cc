import { defineTable } from "convex/server"
import { v } from "convex/values"
import { botConfig, botOutcome, voiceUsage } from "./voice"
import { fileReference } from "./storage"

export const callStatus = v.union(
  ...(
    [
      "queued",
      "ringing",
      "connected",
      "completed",
      "failed",
      "missed",
      "rejected",
    ] as const
  ).map((s) => v.literal(s))
)
export const handlingMode = v.union(v.literal("gateway"), v.literal("api"))
export const callSession = v.object({
  sdp_type: v.union(v.literal("offer"), v.literal("answer")),
  sdp: v.string(),
})
export const callMedia = v.object({
  ...fileReference,
  mediaId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  contentType: v.optional(v.string()),
  error: v.optional(v.string()),
})
export const callingRouting = v.union(
  v.object({ kind: v.literal("agents") }),
  v.object({ kind: v.literal("api") }),
  v.object({ kind: v.literal("bot"), botId: v.id("voiceBots") })
)
export const callingTables = {
  callAgents: defineTable({
    organizationId: v.string(),
    userId: v.string(),
    name: v.string(),
    authSessionId: v.string(),
    browserId: v.string(),
    leaseId: v.string(),
    status: v.union(v.literal("online"), v.literal("away")),
    reservedCallId: v.optional(v.id("calls")),
    reservationUntil: v.optional(v.number()),
    extension: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_userId", ["organizationId", "userId"]),
  calls: defineTable({
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    wacid: v.optional(v.string()),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    status: callStatus,
    mode: handlingMode,
    userId: v.optional(v.string()),
    parentUserId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    contactId: v.optional(v.id("contacts")),
    channelContactId: v.optional(v.id("channelContacts")),
    conversationId: v.optional(v.id("conversations")),
    observedAt: v.number(),
    metaAt: v.optional(v.number()),
    offeredAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    duration: v.optional(v.number()),
    remoteSession: v.optional(callSession),
    localSession: v.optional(callSession),
    preAcceptedSdp: v.optional(v.string()),
    bizOpaqueCallbackData: v.optional(v.string()),
    ctaPayload: v.optional(v.string()),
    deeplinkPayload: v.optional(v.string()),
    recording: v.optional(callMedia),
    transcription: v.optional(callMedia),
    gatewayRecordingFile: v.optional(v.string()),
    error: v.optional(v.string()),
    errorCode: v.optional(v.number()),
    errors: v.optional(v.string()),
    assignedAgent: v.optional(v.string()),
    agentLeaseId: v.optional(v.string()),
    agentExtension: v.optional(v.string()),
    mediaUpAt: v.optional(v.number()),
    gatewayAt: v.optional(v.number()),
    gatewayRouted: v.optional(v.boolean()),
    botId: v.optional(v.id("voiceBots")),
    botConfig: v.optional(botConfig),
    botOutcome: v.optional(botOutcome),
    botSummary: v.optional(v.string()),
    botFallbackReason: v.optional(v.string()),
    botStartedAt: v.optional(v.number()),
    botEndedAt: v.optional(v.number()),
    botActive: v.optional(v.boolean()),
    botDuration: v.optional(v.number()),
    botUsage: v.optional(voiceUsage),
    operation: v.optional(v.string()),
    operationUntil: v.optional(v.number()),
  })
    .index("by_organizationId_and_botActive", ["organizationId", "botActive"])
    .index("by_organizationId_and_botStartedAt", [
      "organizationId",
      "botStartedAt",
    ])
    .index("by_organizationId_and_assignedAgent_and_status", [
      "organizationId",
      "assignedAgent",
      "status",
    ])
    .index("by_organizationId_and_mode_and_status", [
      "organizationId",
      "mode",
      "status",
    ])
    .index("by_accountId_and_userId", ["accountId", "userId"])
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId_and_wacid", ["accountId", "wacid"])
    .index("by_organizationId_and_accountId", ["organizationId", "accountId"]),
  callEvents: defineTable({
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    wacid: v.string(),
    event: v.string(),
    callId: v.optional(v.id("calls")),
    at: v.number(),
    details: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_accountId_and_wacid_and_event", ["accountId", "wacid", "event"])
    .index("by_callId", ["callId"]),
  callPermissions: defineTable({
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    identity: v.string(),
    status: v.string(),
    expiresAt: v.optional(v.number()),
    observedAt: v.number(),
    data: v.string(),
  })
    .index("by_accountId_and_identity", ["accountId", "identity"])
    .index("by_organizationId", ["organizationId"]),
  callingSettings: defineTable({
    organizationId: v.string(),
    accountId: v.id("channelAccounts"),
    mode: handlingMode,
    routing: v.optional(callingRouting),
    settings: v.string(),
    updatedAt: v.number(),
    restrictions: v.optional(v.string()),
  })
    .index("by_accountId", ["accountId"])
    .index("by_routing_botId", ["routing.botId"])
    .index("by_organizationId", ["organizationId"]),
  gatewayEvents: defineTable({
    organizationId: v.string(),
    eventId: v.string(),
    callId: v.id("calls"),
    at: v.number(),
    event: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_eventId", ["eventId"])
    .index("by_callId", ["callId"]),
  gatewayNonces: defineTable({
    nonce: v.string(),
    expiresAt: v.number(),
  }).index("by_nonce", ["nonce"]),
}
