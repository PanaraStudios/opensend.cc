import { registerIvrRoutes } from "../ivr/routes"
import { registerVoiceRoutes } from "./voice"
import { registerCallingRoutes } from "./calling"
import { registerMediaRoutes } from "./media"
import { registerPageMessageRoutes } from "./channelMessages"
import { registerWhatsAppRoutes } from "./whatsapp"
import { registerUsageRoutes } from "./usage"
import { registerSuppressionRoutes } from "./suppressions"
import { registerWebhookRoutes } from "./webhooks"
import { registerAutomationRoutes } from "./automations"
import { registerImportRoutes } from "./imports"
import { registerMetricsRoutes } from "./metrics"
import { registerOAuthGrantRoutes } from "./oauth"
import { registerReceivedRoutes } from "./received"
import type { HttpRouter } from "convex/server"
import { registerAudienceRoutes } from "./audience"
import { registerTemplateRoutes } from "./templates"
import { registerDomainRoutes } from "./domains"
import { registerEmailRoutes } from "./emails"
import { registerEventRoutes } from "./events"
import { registerApiKeyRoutes } from "./keys"
import { registerLogRoutes } from "./logs"

/** The public REST API. Each resource registers its routes with `apiRoute`
    (./route.ts); add yours here. */
export function registerApiRoutes(http: HttpRouter) {
  registerIvrRoutes(http)
  registerCallingRoutes(http)
  registerVoiceRoutes(http)
  registerMediaRoutes(http)
  registerWhatsAppRoutes(http)
  registerPageMessageRoutes(http)
  registerUsageRoutes(http)
  registerAutomationRoutes(http)
  registerImportRoutes(http)
  registerMetricsRoutes(http)
  registerOAuthGrantRoutes(http)
  registerApiKeyRoutes(http)
  registerDomainRoutes(http)
  registerEmailRoutes(http)
  registerReceivedRoutes(http)
  registerEventRoutes(http)
  registerLogRoutes(http)
  registerAudienceRoutes(http)
  registerTemplateRoutes(http)
  registerSuppressionRoutes(http)
  registerWebhookRoutes(http)
}
