import { defineApp } from "convex/server"
import { v } from "convex/values"
import opensend from "@opensendcc/convex/convex.config.js"
const app = defineApp({
  env: {
    OPENSEND_API_KEY: v.optional(v.string()),
    OPENSEND_BASE_URL: v.optional(v.string()),
    OPENSEND_WEBHOOK_SECRET: v.optional(v.string()),
  },
})
app.use(opensend)
export default app
