import type { HttpRouter } from "convex/server"
import { registerDomainRoutes } from "./domains"
import { registerEventRoutes } from "./events"
import { registerApiKeyRoutes } from "./keys"
import { registerLogRoutes } from "./logs"

/** The public REST API. Each resource registers its routes with `apiRoute`
    (./route.ts); add yours here. */
export function registerApiRoutes(http: HttpRouter) {
  registerApiKeyRoutes(http)
  registerDomainRoutes(http)
  registerEventRoutes(http)
  registerLogRoutes(http)
}
