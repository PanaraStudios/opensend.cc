import { defineApp } from "convex/server"
import { v } from "convex/values"
import betterAuth from "./betterAuth/convex.config"
const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    SSO_ENCRYPTION_KEY: v.string(),
    ALLOW_LOCAL_OIDC: v.optional(v.string()),
  },
})
app.use(betterAuth)
export default app
