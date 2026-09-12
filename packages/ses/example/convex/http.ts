import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { ses } from "./example"

const http = httpRouter()

// Subscribe this URL (https://<deployment>.convex.site/ses-webhook) to the SNS
// topic that your SES configuration set publishes events to.
http.route({
  path: "/ses-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await ses.handleSesEventWebhook(ctx, req)
  }),
})

export default http
