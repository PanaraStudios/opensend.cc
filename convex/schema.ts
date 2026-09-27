import { defineSchema } from "convex/server"
import { audienceTables } from "./tables/audience"
import { domainTables } from "./tables/domains"
import { eventTables } from "./tables/events"
import { sesTables } from "./tables/ses"
import { templateTables } from "./tables/templates"
import { webhookTables } from "./tables/webhooks"

/* Each feature owns one file in ./tables, so features can be built in
   parallel without editing the same lines here. */
export default defineSchema({
  ...sesTables,
  ...domainTables,
  ...eventTables,
  ...templateTables,
  ...audienceTables,
  ...webhookTables,
})
