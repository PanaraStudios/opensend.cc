/* A fake Meta Graph API for the e2e suite. scripts/test-e2e.mjs starts it
   and points the backend at it with META_GRAPH_ORIGIN.

   Graph calls: /{version}/{path}, answered from ROUTES by method and path
   (without the version). Later lanes add their routes to the table.

   Control API, for tests:
   - GET  /__calls      the recorded Graph calls: method, path, query, body
   - POST /__reset      forget calls and overrides
   - POST /__responses  { method?, path, status?, body } answers every call
                        whose path (without the version) matches the regex
                        `path` until the next reset, e.g. to simulate errors
   - POST /__templates/{id}  { status } sets a submitted template's review
                        status, as Meta's listing reports it after review */
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

/* WhatsApp state the connect routes share: every WABA has one phone
   number, `${wabaId}0`, which `/register` moves onto Cloud API. It lives for
   the server's lifetime; /__reset clears only calls and overrides. */
let messageSequence = 0
let mediaSequence = 0
let callSequence = 0
const callingSettings = new Map()
const numbers = new Map()
const phoneNumberOf = (wabaId) => {
  const id = `${wabaId}0`
  if (!numbers.has(id)) numbers.set(id, { wabaId, registered: false })
  return id
}
const phoneNumber = (id) => {
  const { registered } = numbers.get(id)
  return {
    id,
    display_phone_number: `+1 555-${id.slice(-5, -1).padStart(4, "0")}`,
    verified_name: "Opensend E2E",
    quality_rating: "GREEN",
    status: registered ? "CONNECTED" : "PENDING",
    code_verification_status: "VERIFIED",
    platform_type: registered ? "CLOUD_API" : "NOT_APPLICABLE",
    throughput: { level: "STANDARD" },
    whatsapp_business_manager_messaging_limit: "TIER_1K",
  }
}
/* Message templates per WABA: POST creates one PENDING, DELETE removes it,
   and every listing also carries SYNCED_TEMPLATE, as if it were made in
   WhatsApp Manager. Template ids are numeric like Meta's. */
const templates = new Map()
let nextTemplateId = 9900001
export const SYNCED_TEMPLATE = {
  id: "9900000",
  name: "e2e_synced_offer",
  language: "en_US",
  category: "MARKETING",
  status: "APPROVED",
  parameter_format: "POSITIONAL",
  components: [{ type: "BODY", text: "Our spring offer is live." }],
}
const listTemplates = (wabaId) => [
  ...[...templates.values()]
    .filter((entry) => entry.wabaId === wabaId)
    .map((entry) => entry.template),
  SYNCED_TEMPLATE,
]

export const FACEBOOK_PAGE = {
  id: "555000100",
  name: "Opensend Messenger E2E",
  access_token: "EAAPageE2EToken0123456789abcdef",
  instagram_business_account: {
    id: "178414000001",
    username: "opensend_ig_e2e",
    name: "Opensend Instagram E2E",
  },
}

/** The app ID in an app access token, `Bearer {app-id}|{secret}`. */
const appIdOf = (authorization = "") =>
  /^Bearer (\d+)\|/.exec(authorization)?.[1]

/** Canned answers: `respond(match, call)` returns `{ status?, body }`. */
export const ROUTES = [
  {
    method: "GET",
    path: /^\/\d+\/settings$/,
    respond: ([path]) => ({
      body: { calling: callingSettings.get(path) ?? { status: "DISABLED" } },
    }),
  },
  {
    method: "POST",
    path: /^\/\d+\/settings$/,
    respond: ([path], call) => {
      callingSettings.set(path, {
        ...(callingSettings.get(path) ?? {}),
        ...call.body.calling,
      })
      return { body: { success: true } }
    },
  },
  {
    method: "POST",
    path: /^\/\d+\/calls$/,
    respond: (_, call) => ({
      body:
        call.body.action === "connect"
          ? { calls: [{ id: `wacid.e2e.${++callSequence}` }] }
          : { success: true },
    }),
  },
  {
    method: "GET",
    path: /^\/\d+\/call_permissions$/,
    respond: () => ({
      body: {
        messaging_product: "whatsapp",
        permission: { status: "permanent" },
        actions: [
          {
            action_name: "start_call",
            can_perform_action: true,
            limits: [
              { time_period: "P1D", max_allowed: 100, current_usage: 0 },
            ],
          },
        ],
      },
    }),
  },
  {
    method: "POST",
    path: /^\/\d+\/messages$/,
    respond: (_, call) =>
      call.body?.recipient && typeof call.body.recipient === "object"
        ? {
            body: {
              recipient_id: call.body.recipient.id,
              message_id: `mid.${++messageSequence}`,
            },
          }
        : {
            body: {
              messaging_product: "whatsapp",
              messages: [{ id: `wamid.${++messageSequence}` }],
            },
          },
  },
  {
    method: "POST",
    path: /^\/\d+\/media$/,
    respond: () => ({ body: { id: `meta-upload-${++mediaSequence}` } }),
  },
  // Embedded Signup: the token code becomes a business token.
  {
    method: "GET",
    path: /^\/oauth\/access_token$/,
    respond: (_, call) => ({
      body: {
        access_token: `EAAE2EBusinessToken${call.query.code ?? ""}`,
        token_type: "bearer",
      },
    }),
  },
  {
    method: "GET",
    path: /^\/me\/accounts$/,
    respond: () => ({ body: { data: [FACEBOOK_PAGE] } }),
  },
  // Token checks: every token is a valid WhatsApp token for the caller's
  // app, not limited to particular WABAs.
  {
    method: "GET",
    path: /^\/debug_token$/,
    respond: (_, call) => ({
      body: {
        data: {
          app_id: appIdOf(call.authorization),
          is_valid: true,
          scopes: [
            "whatsapp_business_management",
            "whatsapp_business_messaging",
            "business_management",
            "pages_messaging",
            "pages_manage_metadata",
            "pages_show_list",
            "instagram_basic",
            "instagram_manage_messages",
          ],
        },
      },
    }),
  },
  // Webhooks on a WABA: POST subscribes the app, DELETE unsubscribes it.
  {
    method: "POST",
    path: /^\/\d+\/subscribed_apps$/,
    respond: () => ({ body: { success: true } }),
  },
  {
    method: "DELETE",
    path: /^\/\d+\/subscribed_apps$/,
    respond: () => ({ body: { success: true } }),
  },
  {
    method: "GET",
    path: /^\/(\d+)\/phone_numbers$/,
    respond: ([, wabaId]) => ({
      body: { data: [phoneNumber(phoneNumberOf(wabaId))] },
    }),
  },
  {
    method: "POST",
    path: /^\/(\d+)\/register$/,
    respond: ([, id], call) => {
      if (!numbers.has(id) || !/^\d{6}$/.test(call.body?.pin ?? ""))
        return {
          status: 400,
          body: graphError("Invalid parameter", 100),
        }
      numbers.get(id).registered = true
      return { body: { success: true } }
    },
  },
  // Media: the metadata lookup and the unversioned download URL it names.
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
  // Message templates: create, list, delete, and edit or read by id.
  {
    method: "POST",
    path: /^\/(\d+)\/message_templates$/,
    respond: ([, wabaId], call) => {
      const id = String(nextTemplateId++)
      templates.set(id, {
        wabaId,
        template: {
          id,
          name: call.body?.name,
          language: call.body?.language,
          category: call.body?.category,
          status: "PENDING",
          parameter_format: String(call.body?.parameter_format).toUpperCase(),
          components: call.body?.components ?? [],
        },
      })
      return {
        body: { id, status: "PENDING", category: call.body?.category },
      }
    },
  },
  {
    method: "GET",
    path: /^\/(\d+)\/message_templates$/,
    respond: ([, wabaId]) => ({
      body: {
        data: listTemplates(wabaId),
        paging: { cursors: { before: "before", after: "after" } },
      },
    }),
  },
  {
    method: "DELETE",
    path: /^\/(\d+)\/message_templates$/,
    respond: (_, call) => {
      templates.delete(call.query.hsm_id)
      return { body: { success: true } }
    },
  },
  {
    method: "POST",
    path: /^\/(99\d{5})$/,
    respond: ([, id], call) => {
      const template = templates.get(id)?.template
      if (!template)
        return { status: 400, body: graphError("Template not found", 100) }
      Object.assign(template, {
        components: call.body?.components ?? template.components,
        status: "PENDING",
      })
      return { body: { success: true } }
    },
  },
  {
    method: "GET",
    path: /^\/(99\d{5})$/,
    respond: ([, id]) => ({
      body: templates.get(id)?.template ?? { id, status: "APPROVED" },
    }),
  },
  // Media header samples: the Resumable Upload API's session and upload.
  {
    method: "POST",
    path: /^\/\d+\/uploads$/,
    respond: () => ({ body: { id: "upload:e2e-session" } }),
  },
  {
    method: "POST",
    path: /^\/upload:[\w-]+$/,
    respond: () => ({ body: { h: "4::e2e-sample-handle" } }),
  },
  // One object by ID: a phone number, or the Meta app (verification) and
  // WABAs, which only need an ID and a name.
  {
    method: "GET",
    path: /^\/(\d+)$/,
    respond: ([, id], call) => ({
      body: numbers.has(id)
        ? phoneNumber(id)
        : id === FACEBOOK_PAGE.id
          ? FACEBOOK_PAGE
          : call.query.fields === "first_name,last_name"
            ? { id, first_name: "Ada", last_name: "E2E" }
            : call.query.fields === "name,username,profile_pic"
              ? {
                  id,
                  name: "Grace E2E",
                  username: "grace_e2e",
                  profile_pic: "https://example.com/grace.png",
                }
              : { id, name: "Opensend E2E" },
    }),
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
    const reviewed = /^\/__templates\/(\d+)$/.exec(url.pathname)
    if (reviewed && method === "POST") {
      const template = templates.get(reviewed[1])?.template
      if (!template) return send(response, 404, { ok: false })
      template.status = JSON.parse(raw || "{}").status
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
        } = await route.respond(
          match,
          call,
          `http://host.docker.internal:${server.address().port}`
        )
        // Behave like Meta fetching a presigned media link, without buffering it.
        const media =
          call.body?.image ??
          call.body?.document ??
          call.body?.video ??
          call.body?.audio
        if (
          path.endsWith("/messages") &&
          media?.link &&
          new URL(media.link).searchParams.has("X-Amz-Signature")
        ) {
          const url = new URL(media.link)
          if (
            !["host.docker.internal", "127.0.0.1", "localhost"].includes(
              url.hostname
            )
          )
            return send(
              response,
              400,
              graphError("Unexpected test bucket host", 100)
            )
          const host = url.host
          url.hostname = "127.0.0.1"
          const file = await fetch(url, { headers: { Host: host } })
          if (!file.ok)
            return send(
              response,
              400,
              graphError(`Media fetch returned ${file.status}`, 100)
            )
          let size = 0
          for await (const chunk of file.body) size += chunk.byteLength
          call.fetchedMedia = {
            size,
            contentType: file.headers.get("content-type"),
          }
        }
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
