import { defineApp } from "convex/server"
import { v } from "convex/values"
import betterAuth from "./betterAuth/convex.config"
import workflow from "@convex-dev/workflow/convex.config.js"
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    SSO_ENCRYPTION_KEY: v.string(),
    ALLOW_LOCAL_OIDC: v.optional(v.string()),
    SES_ENCRYPTION_KEY: v.optional(v.string()),
    SES_CALLBACK_ORIGIN: v.optional(v.string()),
  },
})
app.use(betterAuth)
app.use(workflow)
app.use(rateLimiter)
export default app
