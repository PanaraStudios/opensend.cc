import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "domain status checks",
  { minutes: 1 },
  internal.domains.dispatchChecks,
  {}
)

export default crons
