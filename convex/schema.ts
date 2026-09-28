import { defineSchema } from "convex/server"
import { audienceTables } from "./tables/audience"
import { automationEventTables } from "./tables/automationEvents"
import { apiTables } from "./tables/api"
import { domainTables } from "./tables/domains"
import { emailTables } from "./tables/emails"
import { eventTables } from "./tables/events"
import { exportTables } from "./tables/exports"
import { receivingTables } from "./tables/receiving"
import { smtpTables } from "./tables/smtp"
import { sesTables } from "./tables/ses"
import { templateTables } from "./tables/templates"
import { unsubscribeTables } from "./tables/unsubscribe"
import { webhookTables } from "./tables/webhooks"

/* Each feature owns one file in ./tables, so features can be built in
   parallel without editing the same lines here. */
export default defineSchema({
  ...sesTables,
  ...smtpTables,
  ...domainTables,
  ...eventTables,
  ...templateTables,
  ...audienceTables,
  ...webhookTables,
  ...apiTables,
  ...exportTables,
  ...emailTables,
  ...automationEventTables,
  ...unsubscribeTables,
  ...receivingTables,
})
