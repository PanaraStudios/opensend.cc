import { TableAggregate } from "@convex-dev/aggregate"
import { components } from "../_generated/api"
import type { DataModel } from "../_generated/dataModel"
/** Calls are the source of truth. Reserve their duration caps atomically, then
 * replace with measured duration at completion. UTC ranges read O(log n) nodes. */
export const minuteUsage = new TableAggregate<{
  Namespace: string
  Key: number
  DataModel: DataModel
  TableName: "calls"
}>(components.voiceMinuteUsage, {
  namespace: (call) => call.organizationId,
  sortKey: (call) => call.botStartedAt ?? 0,
  sumValue: (call) =>
    call.botEndedAt
      ? (call.botDuration ?? 0)
      : (call.botConfig?.maxDurationSeconds ?? 0),
})
