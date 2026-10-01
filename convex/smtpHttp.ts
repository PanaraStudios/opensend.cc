import type { HttpRouter } from "convex/server"
import { apiRoute } from "./api/route"
import { MAX_SEND_BODY, sendEmailBody } from "./api/emails"

/** The gateway authenticates with the client's API key, never an admin secret. */
export function registerSmtpRoutes(http: HttpRouter) {
  apiRoute(http, {
    method: "POST",
    path: "/smtp/auth",
    scope: { resource: "emails", access: "write" },
    source: "smtp",
    maxBody: 0,
    handler: async () => ({ body: { authenticated: true } }),
  })
  apiRoute(http, {
    method: "POST",
    path: "/smtp/emails",
    scope: { resource: "emails", access: "write" },
    source: "smtp",
    maxBody: MAX_SEND_BODY,
    handler: async (ctx, { caller, body }) =>
      sendEmailBody(ctx, caller, body, "smtp"),
  })
}
