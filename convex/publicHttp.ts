"use node"
import { v } from "convex/values"
import { env, internalAction } from "./_generated/server"
import { publicFetch } from "../lib/net/public-fetch"

/** The default runtime cannot pin DNS. OIDC crosses into Node for all IO. */
export const request = internalAction({
  args: {
    url: v.string(),
    method: v.union(v.literal("GET"), v.literal("POST")),
    headers: v.record(v.string(), v.string()),
    body: v.optional(v.string()),
    localOrigin: v.optional(v.string()),
  },
  returns: v.object({ status: v.number(), body: v.string() }),
  handler: async (_ctx, { url, ...options }) => {
    const response = await publicFetch(url, {
      ...options,
      localOrigin:
        env.ALLOW_LOCAL_OIDC === "true" ? options.localOrigin : undefined,
    })
    return { status: response.status, body: await response.text() }
  },
})
