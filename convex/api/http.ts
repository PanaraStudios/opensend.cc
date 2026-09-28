import type { HttpRouter } from "convex/server"
import { registerDomainRoutes } from "./domains"
import { registerEmailRoutes } from "./emails"
import { registerApiKeyRoutes } from "./keys"
import { registerLogRoutes } from "./logs"

/** The public REST API. Each resource registers its routes with `apiRoute`
    (./route.ts); add yours here. */
export function registerApiRoutes(http: HttpRouter) {
  registerApiKeyRoutes(http)
  registerDomainRoutes(http)
  registerEmailRoutes(http)
  registerLogRoutes(http)
}
