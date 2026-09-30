import "server-only"
export async function oauthProxy(request: Request) {
  const site = process.env.CONVEX_INTERNAL_SITE_URL
  if (!site) throw new Error("CONVEX_INTERNAL_SITE_URL is required")
  const url = new URL(request.url)
  const headers = new Headers(request.headers)
  // HTTPS deployments route by Host; the dashboard hostname is not upstream's.
  if (new URL(site).protocol === "https:")
    headers.set("host", new URL(site).host)
  const response = await fetch(`${site}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
    cache: "no-store",
  })
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  })
}
