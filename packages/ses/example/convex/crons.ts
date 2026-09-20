import { cronJobs } from "convex/server"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"

const crons = cronJobs()

crons.interval(
  "Remove old emails from the ses component",
  { hours: 1 },
  internal.crons.cleanupSes
)

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const cleanupSes = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.ses.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    })
    await ctx.scheduler.runAfter(
      0,
      components.ses.lib.cleanupAbandonedEmails,
      // These generally indicate a bug, so keep them around for longer.
      { olderThan: 4 * ONE_WEEK_MS }
    )
    return null
  },
})

export default crons
