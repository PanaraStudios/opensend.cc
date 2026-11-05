import { v } from "convex/values"
import { callerValue } from "../api/caller"

/** Internal actors: authenticated dashboard/REST callers or a validated durable run. */
export const actorArgs = {
  organizationId: v.string(),
  caller: v.optional(callerValue),
  automationRunId: v.optional(v.id("automationRuns")),
}
