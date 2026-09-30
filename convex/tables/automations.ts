import { defineTable } from "convex/server"
import { v } from "convex/values"

export const automationStatus = v.union(
  v.literal("enabled"),
  v.literal("disabled")
)
export const runStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
)
export const stepStatus = v.union(runStatus, v.literal("skipped"))
export const stepType = v.union(
  v.literal("trigger"),
  v.literal("condition"),
  v.literal("delay"),
  v.literal("wait_for_event"),
  v.literal("send_email"),
  v.literal("contact_update"),
  v.literal("contact_delete"),
  v.literal("add_to_segment")
)
export const payloadValue = v.record(v.string(), v.any())

export const automationTables = {
  automationEventLinks: defineTable({
    organizationId: v.string(),
    automationId: v.id("automations"),
    name: v.string(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_automationId", [
      "organizationId",
      "automationId",
    ])
    .index("by_organizationId_and_name", ["organizationId", "name"]),
  automations: defineTable({
    organizationId: v.string(),
    name: v.string(),
    status: automationStatus,
    trigger: v.string(),
    graph: v.string(),
    apiDefinition: v.optional(v.string()),
    deleted: v.boolean(),
    updatedAt: v.number(),
    enabledAt: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_deleted", ["organizationId", "deleted"])
    .index("by_organizationId_and_deleted_and_status", [
      "organizationId",
      "deleted",
      "status",
    ])
    .index("by_organizationId_and_trigger_and_status", [
      "organizationId",
      "trigger",
      "status",
    ]),
  automationRuns: defineTable({
    organizationId: v.string(),
    automationId: v.id("automations"),
    contactId: v.id("contacts"),
    contactEmail: v.string(),
    eventId: v.optional(v.id("events")),
    lastSignalEventId: v.optional(v.id("events")),
    payload: payloadValue,
    graph: v.string(),
    apiDefinition: v.optional(v.string()),
    trigger: v.string(),
    status: runStatus,
    sent: v.number(),
    completedAt: v.optional(v.number()),
    workflowId: v.optional(v.string()),
    waitingName: v.optional(v.string()),
    waitingKey: v.optional(v.string()),
    waitingAt: v.optional(v.number()),
    deadline: v.optional(v.number()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_automationId", [
      "organizationId",
      "automationId",
    ])
    .index("by_organizationId_and_automationId_and_status", [
      "organizationId",
      "automationId",
      "status",
    ])
    .index("by_organizationId_and_automationId_and_eventId", [
      "organizationId",
      "automationId",
      "eventId",
    ])
    .index("by_organizationId_and_contactId_and_waitingName", [
      "organizationId",
      "contactId",
      "waitingName",
    ]),
  automationRunSteps: defineTable({
    organizationId: v.string(),
    automationId: v.id("automations"),
    runId: v.id("automationRuns"),
    key: v.string(),
    type: stepType,
    status: stepStatus,
    startedAt: v.number(),
    runStartedAt: v.number(),
    completedAt: v.optional(v.number()),
    output: v.optional(payloadValue),
    error: v.optional(v.string()),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_runId_and_key", [
      "organizationId",
      "runId",
      "key",
    ]),
}
