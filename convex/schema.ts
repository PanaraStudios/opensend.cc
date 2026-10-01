import { ivrTables } from "./tables/ivr"
import { callingTables } from "./tables/calling"
import { storageTables } from "./tables/storage"
import { receivedTables } from "./tables/received"
import { broadcastTables } from "./tables/broadcasts"
import { channelTables } from "./tables/channels"
import { metaTables } from "./tables/meta"
import { automationTables } from "./tables/automations"
import { defineSchema } from "convex/server"
import { audienceTables } from "./tables/audience"
import { automationEventTables } from "./tables/automationEvents"
import { apiTables } from "./tables/api"
import { domainClaimTables } from "./tables/domainClaims"
import { domainTables } from "./tables/domains"
import { emailShareTables } from "./tables/emailShares"
import { emailTables } from "./tables/emails"
import { eventTables } from "./tables/events"
import { exportTables } from "./tables/exports"
import { metricsTables } from "./tables/metrics"
import { receivingTables } from "./tables/receiving"
import { smtpTables } from "./tables/smtp"
import { sesTables } from "./tables/ses"
import { teamTables } from "./tables/teams"
import { templateTables } from "./tables/templates"
import { unsubscribeTables } from "./tables/unsubscribe"
import { webhookTables } from "./tables/webhooks"

/* Each feature owns one file in ./tables, so features can be built in
   parallel without editing the same lines here. */
export default defineSchema({
  ...ivrTables,
  ...callingTables,
  ...storageTables,
  ...broadcastTables,
  ...automationTables,
  ...sesTables,
  ...smtpTables,
  ...metricsTables,
  ...domainTables,
  ...domainClaimTables,
  ...eventTables,
  ...templateTables,
  ...teamTables,
  ...audienceTables,
  ...webhookTables,
  ...apiTables,
  ...exportTables,
  ...emailTables,
  ...emailShareTables,
  ...automationEventTables,
  ...unsubscribeTables,
  ...receivingTables,
  ...receivedTables,
  ...metaTables,
  ...channelTables,
})
