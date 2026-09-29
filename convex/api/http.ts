import { registerSuppressionRoutes } from "./suppressions"
import { registerWebhookRoutes } from "./webhooks"
import { registerAutomationRoutes } from "./automations"
import { registerImportRoutes } from "./imports"
import { registerMetricsRoutes } from "./metrics"
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
  registerAutomationRoutes(http)
  registerImportRoutes(http)
  registerMetricsRoutes(http)
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
