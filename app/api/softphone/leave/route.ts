/** Same-origin relay allows sendBeacon to survive tab closure without auth headers. */
export async function POST(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return new Response(null, { status: 400 })
  let bytes = 0,
    body = ""
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 2048) {
        await reader.cancel()
        return new Response(null, { status: 413 })
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  const site = process.env.CONVEX_INTERNAL_SITE_URL
  if (!site) return new Response(null, { status: 503 })
  try {
    const response = await fetch(new URL("/calling/softphone/leave", site), {
      method: "POST",
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: { "content-type": "text/plain" },
    })
    return new Response(null, { status: response.status })
  } catch {
    return new Response(null, { status: 503 })
  }
}
