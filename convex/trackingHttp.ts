import type { HttpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { internal } from "./_generated/api"

const noCache = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Referrer-Policy": "no-referrer",
}
const pixel = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0)
)
export function registerTrackingRoutes(http: HttpRouter) {
  for (const kind of ["o", "c"] as const)
    http.route({
      pathPrefix: `/t/${kind}/`,
      method: "GET",
      handler: httpAction(async (ctx, request) => {
        const token = new URL(request.url).pathname.slice(`/t/${kind}/`.length)
        const hit = await ctx.runMutation(internal.tracking.hit, {
          token,
          kind,
          userAgent: request.headers.get("user-agent") ?? "",
          // The reverse proxy must overwrite this header, never append it.
          ipAddress: request.headers.get("x-real-ip") ?? "",
        })
        if (!hit) return new Response(null, { status: 404, headers: noCache })
        if (hit.limited)
          return new Response(null, {
            status: 429,
            headers: { ...noCache, "Retry-After": "60" },
          })
        return kind === "c"
          ? new Response(null, {
              status: 302,
              headers: { ...noCache, Location: hit.location! },
            })
          : new Response(pixel, {
              headers: { ...noCache, "Content-Type": "image/gif" },
            })
      }),
    })
  http.route({
    path: "/t/ask",
    method: "GET",
    handler: httpAction(async (ctx, request) => {
      const hostname = new URL(request.url).searchParams.get("domain") ?? ""
      const allowed = await ctx.runQuery(internal.tracking.allowedHost, {
        hostname,
      })
      return new Response(null, {
        status: allowed ? 200 : 403,
        headers: noCache,
      })
    }),
  })
}
