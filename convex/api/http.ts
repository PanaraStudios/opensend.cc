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
  registerApiKeyRoutes(http)
  registerDomainRoutes(http)
  registerEmailRoutes(http)
  registerEventRoutes(http)
  registerLogRoutes(http)
  registerAudienceRoutes(http)
  registerTemplateRoutes(http)
}
