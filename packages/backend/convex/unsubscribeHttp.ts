import type { HttpRouter } from "convex/server"
import { env, httpAction } from "./_generated/server"
import { internal } from "./_generated/api"
import { BodyTooLarge, limitedBody } from "./ses/web"

const PREFIX = "/unsubscribe/"
const tokenOf = (request: Request) =>
  new URL(request.url).pathname.slice(PREFIX.length)

/** RFC 8058: the body is `List-Unsubscribe=One-Click`, form-encoded or as a
    multipart field. */
function isOneClick(body: string, contentType: string) {
  if (contentType.includes("multipart/form-data"))
    return /name="List-Unsubscribe"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\nOne-Click\r?\n/.test(
      body
    )
  return (
    new URLSearchParams(body.trim()).get("List-Unsubscribe") === "One-Click"
  )
}

const reply = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } })

/** The mailbox provider's one-click unsubscribe. It answers without a
    redirect, as RFC 8058 requires. */
export const oneClick = httpAction(async (ctx, request) => {
  let body: string
  try {
    body = await limitedBody(request, 4096)
  } catch (e) {
    if (e instanceof BodyTooLarge) return reply(413)
    throw e
  }
  if (!isOneClick(body, request.headers.get("content-type") ?? ""))
    return reply(400)
  const result = await ctx.runMutation(internal.unsubscribe.oneClick, {
    token: tokenOf(request),
  })
  return reply(result === "done" ? 200 : result === "limited" ? 429 : 404)
})

/** Opening the one-click URL never unsubscribes: link scanners fetch it.
    Someone who follows it lands on the preference page instead. */
export const openPage = httpAction(async (_ctx, request) =>
  Response.redirect(
    `${env.SITE_URL}/unsubscribe/${encodeURIComponent(tokenOf(request))}`,
    303
  )
)

export function registerUnsubscribeRoutes(http: HttpRouter) {
  http.route({ pathPrefix: PREFIX, method: "POST", handler: oneClick })
  http.route({ pathPrefix: PREFIX, method: "GET", handler: openPage })
}
