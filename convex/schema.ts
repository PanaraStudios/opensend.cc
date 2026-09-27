import { defineSchema } from "convex/server"
import { apiTables } from "./tables/api"
import { domainTables } from "./tables/domains"
import { eventTables } from "./tables/events"
import { exportTables } from "./tables/exports"
import { sesTables } from "./tables/ses"

/* Each feature owns one file in ./tables, so features can be built in
   parallel without editing the same lines here. */
export default defineSchema({
  ...sesTables,
  ...domainTables,
  ...eventTables,
  ...apiTables,
  ...exportTables,
})
