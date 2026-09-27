import { defineSchema } from "convex/server"
import { domainTables } from "./tables/domains"
import { eventTables } from "./tables/events"
import { sesTables } from "./tables/ses"

/* Each feature owns one file in ./tables, so features can be built in
   parallel without editing the same lines here. */
export default defineSchema({
  ...sesTables,
  ...domainTables,
  ...eventTables,
})
