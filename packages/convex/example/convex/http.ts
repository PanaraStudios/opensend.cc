import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server.js"
import { opensend } from "./email.js"
const http = httpRouter()
http.route({
  path: "/opensend/webhook",
  method: "POST",
  handler: httpAction((ctx, req) =>
    opensend().handleOpenSendEventWebhook(ctx, req)
  ),
})
export default http
