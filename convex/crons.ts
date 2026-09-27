import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "domain status checks",
  { minutes: 1 },
  internal.domains.dispatchChecks,
  {}
)

crons.interval("request log retention", { hours: 1 }, internal.logs.prune, {})
crons.interval(
  "idempotency key expiry",
  { hours: 1 },
  internal.api.state.expireIdempotency,
  {}
)
crons.interval("export expiry", { hours: 1 }, internal.exports.expire, {})

export default crons
