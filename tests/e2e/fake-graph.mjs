/* A fake Meta Graph API for the e2e suite. scripts/test-e2e.mjs starts it
   and points the backend at it with META_GRAPH_ORIGIN.

   Graph calls: /{version}/{path}, answered from ROUTES by method and path
   (without the version). Later lanes add their routes to the table.

   Control API, for tests:
   - GET  /__calls      the recorded Graph calls: method, path, query, body
   - POST /__reset      forget calls and overrides
   - POST /__responses  { method?, path, status?, body } answers every call
                        whose path (without the version) matches the regex
                        `path` until the next reset, e.g. to simulate errors */
import { createServer } from "node:http"

/** A Graph-shaped error body. */
export const graphError = (message, code, extra = {}) => ({
  error: {
    message,
    type: "OAuthException",
    code,
    fbtrace_id: "fake-graph",
    ...extra,
  },
})

/** Canned answers: `respond(match, call)` returns `{ status?, body }`. */
export const ROUTES = [
  {
    method: "GET",
    path: /^\/meta-inbound-media$/,
    respond: (_match, _call, origin) => ({
      body: {
        id: "meta-inbound-media",
        url: `${origin}/media-download/meta-inbound-media`,
        mime_type: "image/png",
        file_size: 3,
      },
    }),
  },
  {
    method: "GET",
    path: /^\/media-download\/meta-inbound-media$/,
    unversioned: true,
    respond: () => ({ body: Buffer.from([1, 2, 3]), contentType: "image/png" }),
  },
  // Meta app verification: GET /{app-id}?fields=id,name
  {
    method: "GET",
    path: /^\/(\d+)$/,
    respond: ([, id]) => ({ body: { id, name: "Opensend E2E" } }),
  },
  // Webhook subscription: POST /{app-id}/subscriptions
  {
    method: "POST",
    path: /^\/\d+\/subscriptions$/,
    respond: () => ({ body: { success: true } }),
  },
]

const VERSIONED = /^\/(v\d+\.\d+)(\/.*)$/

function parseBody(raw, type = "") {
  if (!raw) return undefined
  if (type.includes("application/json")) {
    try {
      return JSON.parse(raw)
    } catch {}
  }
  if (type.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(raw))
  return raw
}

function send(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

/** Starts the server on `port` (every interface, so Docker reaches it
    through host.docker.internal). Resolves once it listens. */
export async function startFakeGraph(port) {
  let calls = []
  let overrides = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString("utf8")
    const url = new URL(request.url ?? "/", "http://fake-graph")
    const method = request.method ?? "GET"
    if (url.pathname === "/__calls" && method === "GET")
      return send(response, 200, calls)
    if (url.pathname === "/__reset" && method === "POST") {
      calls = []
      overrides = []
      return send(response, 200, { ok: true })
    }
    if (url.pathname === "/__responses" && method === "POST") {
      const override = JSON.parse(raw || "{}")
      overrides.unshift({ ...override, path: new RegExp(override.path) })
      return send(response, 200, { ok: true })
    }
    const versioned = VERSIONED.exec(url.pathname)
    const path = versioned?.[2] ?? url.pathname
    if (
      !versioned &&
      !ROUTES.some((route) => route.unversioned && route.path.test(path))
    )
      return send(response, 404, graphError("Unknown path components", 2500))
    const version = versioned?.[1]
    const call = {
      method,
      version,
      path,
      query: Object.fromEntries(url.searchParams),
      body: parseBody(raw, request.headers["content-type"]),
      authorization: request.headers.authorization,
    }
    calls.push(call)
    const override = overrides.find(
      (item) => (!item.method || item.method === method) && item.path.test(path)
    )
    if (override) return send(response, override.status ?? 200, override.body)
    for (const route of ROUTES) {
      const match =
        Boolean(route.unversioned) === !versioned &&
        route.method === method &&
        route.path.exec(path)
      if (match) {
        const {
          status = 200,
          body,
          contentType,
        } = route.respond(
          match,
          call,
          `http://host.docker.internal:${server.address().port}`
        )
        if (contentType) {
          response.writeHead(status, { "content-type": contentType })
          response.end(body)
          return
        }
        return send(response, status, body)
      }
    }
    send(response, 400, graphError(`No fake route for ${method} ${path}`, 100))
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(Number(port), resolve)
  })
  return {
    origin: `http://localhost:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
