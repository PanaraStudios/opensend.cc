import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "domain status checks",
  { minutes: 1 },
  internal.domains.dispatchChecks,
  {}
)

crons.interval(
  "webhook and event retention",
  { hours: 1 },
  internal.webhooks.cleanup,
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
crons.interval(
  "custom event retention",
  { hours: 1 },
  internal.automationEvents.prune,
  {}
)

crons.interval("sent email retention", { hours: 1 }, internal.emails.prune, {})

export default crons
