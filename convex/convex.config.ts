import { defineApp } from "convex/server"
import { v } from "convex/values"
import betterAuth from "./betterAuth/convex.config"
import workflow from "@convex-dev/workflow/convex.config.js"
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"
import workpool from "@convex-dev/workpool/convex.config.js"
import aggregate from "@convex-dev/aggregate/convex.config.js"
import migrations from "@convex-dev/migrations/convex.config.js"
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    OBJECT_STORAGE_ENDPOINT: v.optional(v.string()),
    OBJECT_STORAGE_REGION: v.optional(v.string()),
    OBJECT_STORAGE_BUCKET: v.optional(v.string()),
    OBJECT_STORAGE_ACCESS_KEY_ID: v.optional(v.string()),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: v.optional(v.string()),
    OBJECT_STORAGE_PUBLIC_BASE_URL: v.optional(v.string()),

    SMTP_HOST: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.string(),
    SSO_ENCRYPTION_KEY: v.string(),
    ALLOW_LOCAL_OIDC: v.optional(v.string()),
    // Development and e2e only: log every account-email link while no sender is set.
    LOG_AUTH_LINKS: v.optional(v.string()),
    SES_ENCRYPTION_KEY: v.optional(v.string()),
    SES_CALLBACK_ORIGIN: v.optional(v.string()),
    // Domain Connect signing; see domain-connect/README.md.
    DOMAIN_CONNECT_PRIVATE_KEY: v.optional(v.string()),
    DOMAIN_CONNECT_KEY: v.optional(v.string()),
    DOMAIN_CONNECT_SIGNER: v.optional(v.string()),
    // Development and e2e only: a local fake Graph API origin, honored only
    // for http://localhost, 127.0.0.1 or host.docker.internal.
    META_GRAPH_ORIGIN: v.optional(v.string()),
  },
})
app.use(betterAuth)
app.use(workflow)
app.use(rateLimiter)
// Separate pools so a webhook backlog never delays outgoing mail.
app.use(workpool, { name: "inboundPool" })
app.use(workpool, { name: "sendPool" })
app.use(workpool, { name: "webhookPool" })
app.use(workpool, { name: "channelPool" })
// One aggregate per count, as its README asks; convex/counts.ts owns them.
app.use(aggregate, { name: "contactImportCounts" })
app.use(aggregate, { name: "contactCounts" })
app.use(aggregate, { name: "segmentCounts" })
app.use(aggregate, { name: "segmentMemberCounts" })
app.use(aggregate, { name: "topicCounts" })
app.use(aggregate, { name: "propertyCounts" })
app.use(aggregate, { name: "templateCounts" })
app.use(aggregate, { name: "apiKeyCounts" })
app.use(aggregate, { name: "apiLogCounts" })
app.use(aggregate, { name: "apiKeyLogCounts" })
app.use(aggregate, { name: "webhookCounts" })
app.use(aggregate, { name: "deliveryCounts" })
app.use(aggregate, { name: "webhookAttemptCounts" })
app.use(aggregate, { name: "domainCounts" })
app.use(aggregate, { name: "exportCounts" })
app.use(aggregate, { name: "emailCounts" })
app.use(aggregate, { name: "suppressionCounts" })
app.use(aggregate, { name: "emailRecipientCounts" })
app.use(aggregate, { name: "emailEventCounts" })
app.use(aggregate, { name: "emailDomainCounts" })
app.use(aggregate, { name: "emailMetricCounts" })
app.use(aggregate, { name: "domainMetricCounts" })
app.use(aggregate, { name: "reputationCounts" })
app.use(aggregate, { name: "automationCounts" })
app.use(aggregate, { name: "automationRunCounts" })
app.use(aggregate, { name: "automationStepCounts" })
app.use(aggregate, { name: "receivedEmailCounts" })
app.use(aggregate, { name: "broadcastCounts" })
app.use(aggregate, { name: "broadcastRecipientCounts" })
app.use(aggregate, { name: "broadcastHistoryCounts" })
app.use(aggregate, { name: "broadcastEventCounts" })
app.use(aggregate, { name: "broadcastLinkCounts" })
app.use(aggregate, { name: "broadcastRecipientLinkCounts" })
app.use(aggregate, { name: "usageSentCounts" })
app.use(aggregate, { name: "usageReceivedCounts" })
app.use(aggregate, { name: "usageAutomationCounts" })
app.use(aggregate, { name: "channelMessageCounts" })
app.use(aggregate, { name: "conversationCounts" })
app.use(aggregate, { name: "broadcastMessageCounts" })
app.use(aggregate, { name: "channelAccountCounts" })
app.use(migrations)
export default app
