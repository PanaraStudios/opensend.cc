// @vitest-environment node
import { resolve } from "node:path"
import SwaggerParser from "@apidevtools/swagger-parser"
import Ajv2020, { type AnySchema } from "ajv/dist/2020"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import type { ApiRouteOptions } from "./api/route"
import { api, components, internal } from "./_generated/api"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import type { Id } from "./_generated/dataModel"

const registrations = vi.hoisted(
  () => [] as Pick<ApiRouteOptions, "method" | "path" | "permission">[]
)
vi.mock("./api/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/route")>()
  return {
    ...actual,
    apiRoute: (...args: Parameters<typeof actual.apiRoute>) => {
      const { method, path, permission } = args[1]
      registrations.push({ method, path, permission })
      return actual.apiRoute(...args)
    },
  }
})
// Import the application entry, so registrations outside api/http.ts count too.
import http from "./http"

type Operation = {
  operationId: string
  "x-opensend-permission": string
  requestBody?: { content: Record<string, { schema: AnySchema }> }
  responses: Record<
    string,
    { content: { "application/json": { schema: AnySchema } } }
  >
}
type Contract = {
  openapi: string
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, AnySchema> }
}
let contract: Contract
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false,
})
const operations = (spec: Contract) =>
  Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`)
    )
    .sort()
const validateBody = (schema: AnySchema, body: unknown) => {
  const validate = ajv.compile(schema)
  expect(validate(body), JSON.stringify(validate.errors, null, 2)).toBe(true)
}
async function response(
  path: string,
  method: string,
  result: Response,
  status = method === "POST" &&
  [
    "/api-keys",
    "/domains",
    "/contacts",
    "/segments",
    "/topics",
    "/contact-properties",
    "/templates",
    "/broadcasts",
    "/audiences",
    "/broadcasts/{id}/duplicate",
  ].includes(path)
    ? 201
    : 200
) {
  expect(result.status).toBe(status)
  const operation = contract.paths[path][method.toLowerCase()]
  expect(operation.responses[String(status)]).toBeDefined()
  const schema =
    operation.responses[String(status)].content["application/json"].schema
  const body = await result.json()
  validateBody(schema, body)
  return body
}

beforeAll(async () => {
  // Validation includes OpenAPI 3.1's meta-schema and resolution of every local ref.
  // No remote references are permitted: contract tests never need the network.
  contract = (await SwaggerParser.validate(resolve("openapi/opensend.yaml"), {
    resolve: { http: false },
  })) as unknown as Contract
})
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "contract-file-secret")
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValue(
        new Error("Unexpected network request in contract test")
      )
  )
  vi.spyOn(SESv2Client.prototype, "send").mockRejectedValue(
    new Error("Unexpected AWS request in contract test")
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  const member = await f.actor("contract-member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const { token } = await member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Contract", permission: "full_access", domainId: null },
  })
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    bearer = token
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  return { ...f, call }
}

describe("OpenAPI contract", () => {
  test("validates domain claim creation, retrieval, verification, resumption and ownership conflict", async () => {
    const f = await setup()
    const key = await f.outsider.client.action(api.apiKeys.create, {
      organizationId: f.outsider.team,
      input: {
        name: "Claim contract",
        permission: "full_access",
        domainId: null,
      },
    })
    const input = { name: "mail.example.test" }
    await response(
      "/domains",
      "POST",
      await f.call("/domains", "POST", input, key.token),
      403
    )
    const claim = await response(
      "/domains/claim",
      "POST",
      await f.call("/domains/claim", "POST", input, key.token),
      201
    )
    await response(
      "/domains/claim",
      "POST",
      await f.call("/domains/claim", "POST", input, key.token),
      200
    )
    await response(
      "/domains/{id}/claim",
      "GET",
      await f.call(
        `/domains/${claim.domain_id}/claim`,
        "GET",
        undefined,
        key.token
      )
    )
    await response(
      "/domains/{id}/claim/verify",
      "POST",
      await f.call(
        `/domains/${claim.domain_id}/claim/verify`,
        "POST",
        undefined,
        key.token
      )
    )
  })

  test("is OpenAPI 3.1 and exactly covers every registered REST method/path and permission", () => {
    expect(contract.openapi).toBe("3.1.0")
    expect(registrations.length).toBeGreaterThan(0)
    const actual = registrations
      .map(({ method, path }) => `${method} ${path}`)
      .sort()
    expect(new Set(actual).size).toBe(actual.length)
    expect(operations(contract)).toEqual(actual)
    const dispatchRoutes = new Set(
      registrations.map(
        ({ method, path }) =>
          `${method} ${path.includes("{") ? `${path.slice(0, path.indexOf("{"))}*` : path}`
      )
    )
    // Explicit exclusions make a newly registered direct HTTP API route fail
    // this audit instead of disappearing behind a broad /oauth/* exception.
    const protocols = [
      "GET /.well-known/oauth-authorization-server",
      "GET /.well-known/oauth-authorization-server/oauth",
      "GET /api/auth/*",
      "POST /api/auth/*",
      "GET /oauth/authorize",
      "GET /oauth/jwks",
      "GET /oauth/flow",
      "POST /oauth/flow",
      "POST /oauth/register",
      "POST /oauth/token",
      "POST /oauth/revoke",
      "POST /oauth/introspect",
      "GET /receiving-files/*",
      "GET /email-files/*",
      "GET /ses/health",
      "POST /ses/events",
      "POST /ses/inbound",
      "GET /meta/webhook",
      "GET /t/o/*",
      "GET /t/c/*",
      "GET /t/ask",
      "GET /unsubscribe/*",
      "POST /unsubscribe/*",
    ]
    const directRoutes = http
      .getRoutes()
      .map(([path, method]) => `${method} ${path}`)
      .filter((route) => !dispatchRoutes.has(route))
    expect(directRoutes.sort()).toEqual(protocols.sort())
    for (const { path, method, permission } of registrations)
      expect(
        contract.paths[path][method.toLowerCase()]["x-opensend-permission"]
      ).toBe(permission)
    const ids = Object.values(contract.paths).flatMap((ops) =>
      Object.values(ops).map((op) => op.operationId)
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("all request/response schemas compile as JSON Schema 2020-12", () => {
    for (const methods of Object.values(contract.paths))
      for (const operation of Object.values(methods)) {
        if (operation.requestBody)
          for (const media of Object.values(operation.requestBody.content))
            ajv.compile(media.schema)
        for (const result of Object.values(operation.responses))
          ajv.compile(result.content["application/json"].schema)
      }
  })

  test("plain member sends an email and actual send/get/list bodies match the contract", async () => {
    const f = await setup()
    const input = {
      from: "hi@mail.example.test",
      to: "ada@example.com",
      subject: "Contract",
      html: "<p>Hello</p>",
    }
    validateBody(
      contract.paths["/emails"].post.requestBody!.content["application/json"]
        .schema,
      input
    )
    const sent = await f.call("/emails", "POST", input)
    expect(sent.headers.get("ratelimit-limit")).toBe("10")
    expect(sent.headers.has("ratelimit-remaining")).toBe(true)
    expect(sent.headers.has("ratelimit-reset")).toBe(true)
    const { id } = await response("/emails", "POST", sent)
    const detail = await response(
      "/emails/{id}",
      "GET",
      await f.call(`/emails/${id}`)
    )
    expect(detail).toMatchObject({
      object: "email",
      id,
      last_event: "queued",
      scheduled_at: null,
    })
    await response(
      "/emails/{email_id}/share",
      "POST",
      await f.call(`/emails/${id}/share`, "POST", { expires_in: "2 hours" })
    )
    await response("/emails", "GET", await f.call("/emails"))
    expect(SESv2Client.prototype.send).not.toHaveBeenCalled()
  })

  test("a nonempty domain list and domain detail match actual nullable/optional fields", async () => {
    const f = await setup()
    const page = await response(
      "/domains",
      "GET",
      await f.call("/domains?limit=1")
    )
    expect(page.data).toHaveLength(1)
    expect(page.data[0].id).toBe(f.domain)
    await response("/domains/{id}", "GET", await f.call(`/domains/${f.domain}`))
  })

  test("plain member creates a contact; retrieval preserves null names and typed properties", async () => {
    const f = await setup()
    await response(
      "/contact-properties",
      "POST",
      await f.call("/contact-properties", "POST", {
        key: "score",
        type: "number",
        fallback_value: 0,
      })
    )
    const { id } = await response(
      "/contacts",
      "POST",
      await f.call("/contacts", "POST", { email: "ada@example.com" })
    )
    const contact = await response(
      "/contacts/{id}",
      "GET",
      await f.call(`/contacts/${id}`)
    )
    expect(contact).toMatchObject({
      first_name: null,
      last_name: null,
      properties: { score: { value: 0, type: "number" } },
    })
    await response("/contacts", "GET", await f.call("/contacts"))
  })

  test("retrieves draft/published templates with scalar variable defaults and stable draft version", async () => {
    const f = await setup()
    const { id } = await response(
      "/templates",
      "POST",
      await f.call("/templates", "POST", {
        name: "Welcome",
        html: "<p>{{{score}}}</p>",
        reply_to: ["support@example.com"],
        variables: [{ key: "score", type: "number", fallback_value: 0 }],
      })
    )
    const draft = await response(
      "/templates/{id}",
      "GET",
      await f.call(`/templates/${id}`)
    )
    expect(draft).toMatchObject({
      status: "draft",
      published_at: null,
      variables: [{ key: "score", type: "number", fallback_value: 0 }],
    })
    await response(
      "/templates/{id}/publish",
      "POST",
      await f.call(`/templates/${id}/publish`, "POST")
    )
    const published = await response(
      "/templates/{id}",
      "GET",
      await f.call(`/templates/${id}`)
    )
    expect(published.current_version_id).toBe(draft.current_version_id)
    expect(published.published_at).toEqual(expect.any(String))
  })

  test("team isolation refuses dashboard access with permission and REST resource access with 404", async () => {
    const f = await setup()
    await expect(
      f.outsider.client.query(api.domains.list, {
        organizationId: f.owner.team,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow("permission")
    const other = await f.outsider.client.action(api.apiKeys.create, {
      organizationId: f.outsider.team,
      input: { name: "Other", permission: "full_access", domainId: null },
    })
    const body = await response(
      "/domains/{id}",
      "GET",
      await f.call(`/domains/${f.domain}`, "GET", undefined, other.token),
      404
    )
    expect(body.name).toBe("not_found")
  })

  test("validates actual malformed and unsupported request errors against status-specific schemas", async () => {
    const f = await setup()
    const missing = await response(
      "/contacts",
      "POST",
      await f.call("/contacts", "POST", {}),
      422
    )
    expect(missing.name).toBe("missing_required_field")
    const badPage = await response(
      "/domains",
      "GET",
      await f.call("/domains?limit=0"),
      422
    )
    expect(badPage.name).toBe("validation_error")
    const unsupported = await response(
      "/emails",
      "POST",
      await f.call("/emails", "POST", { topic_id: "unsupported" }),
      422
    )
    expect(unsupported.name).toBe("missing_required_field")
    await response("/domains", "GET", await f.t.fetch("/domains"), 401)
    await response(
      "/domains",
      "GET",
      await f.call("/domains", "GET", undefined, "os_invalid"),
      403
    )
  })

  test("all automation operations and run history match the wire contract", async () => {
    const f = await setup()
    const input = {
      name: "Welcome",
      steps: [
        {
          key: "start",
          type: "trigger",
          config: { event_name: "user.created" },
        },
        { key: "wait", type: "delay", config: { duration: "1 hour" } },
      ],
      connections: [{ from: "start", to: "wait" }],
    }
    const { id } = await response(
      "/automations",
      "POST",
      await f.call("/automations", "POST", input),
      201
    )
    await response("/automations", "GET", await f.call("/automations"))
    await response(
      "/automations/{automation_id}",
      "GET",
      await f.call(`/automations/${id}`)
    )
    await response(
      "/automations/{automation_id}",
      "PATCH",
      await f.call(`/automations/${id}`, "PATCH", { status: "enabled" })
    )
    const copy = await response(
      "/automations/{automation_id}/duplicate",
      "POST",
      await f.call(`/automations/${id}/duplicate`, "POST"),
      201
    )
    await response(
      "/automations/{automation_id}/stop",
      "POST",
      await f.call(`/automations/${id}/stop`, "POST")
    )
    const contact = await (
      await f.call("/contacts", "POST", { email: "run@example.com" })
    ).json()
    const runId = await f.t.run(async (ctx) => {
      const row = (await ctx.db.get("automations", id as Id<"automations">))!
      const run = await insertRow(ctx, "automationRuns", {
        organizationId: f.owner.team,
        automationId: row._id,
        contactId: contact.id,
        contactEmail: "run@example.com",
        trigger: row.trigger,
        graph: row.graph,
        payload: {},
        status: "completed",
        sent: 0,
        completedAt: Date.now(),
      })
      await insertRow(ctx, "automationRunSteps", {
        organizationId: f.owner.team,
        automationId: row._id,
        runId: run,
        key: "start",
        type: "trigger",
        status: "completed",
        startedAt: Date.now(),
        runStartedAt: Date.now(),
        completedAt: Date.now(),
      })
      return run
    })
    await response(
      "/automations/{automation_id}/runs",
      "GET",
      await f.call(`/automations/${id}/runs`)
    )
    await response(
      "/automations/{automation_id}/runs/{run_id}",
      "GET",
      await f.call(`/automations/${id}/runs/${runId}`)
    )
    await response(
      "/automations/{automation_id}",
      "DELETE",
      await f.call(`/automations/${copy.id}`, "DELETE")
    )
  })

  test("multipart contact import creation, list and retrieval match the contract", async () => {
    const f = await setup()
    const { token } = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: { name: "CSV", permission: "full_access", domainId: null },
    })
    const data = new FormData()
    data.append(
      "file",
      new Blob(["email,first_name\nada@example.com,Ada\n"], {
        type: "text/csv",
      }),
      "contacts.csv"
    )
    const { id } = await response(
      "/contacts/imports",
      "POST",
      await f.t.fetch("/contacts/imports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: data,
      }),
      201
    )
    await response(
      "/contacts/imports",
      "GET",
      await f.call("/contacts/imports")
    )
    await response(
      "/contacts/imports/{id}",
      "GET",
      await f.call(`/contacts/imports/${id}`)
    )
  })

  test("metrics totals and dimension rows match the contract", async () => {
    const f = await setup()
    await response("/emails/metrics", "GET", await f.call("/emails/metrics"))
    await response(
      "/emails/metrics",
      "GET",
      await f.call(
        `/emails/metrics?dimensions=period,domain&domain_id=${f.domain}&metrics=sent,delivered`
      )
    )
  })

  test("OAuth grant routes accept API keys and share the REST error contract", async () => {
    const f = await setup()
    const listed = await response(
      "/oauth/grants",
      "GET",
      await f.call("/oauth/grants"),
      200
    )
    expect(listed).toEqual({ object: "list", has_more: false, data: [] })
    const revoked = await response(
      "/oauth/grants/{id}",
      "DELETE",
      await f.call("/oauth/grants/unknown", "DELETE"),
      404
    )
    expect(revoked.name).toBe("not_found")
  })

  test("validates every new parity route with nonempty authenticated responses", async () => {
    const f = await setup()
    const key = await response(
      "/api-keys",
      "POST",
      await f.call("/api-keys", "POST", { name: "Contract key" })
    )
    await response(
      "/api-keys/{id}",
      "PATCH",
      await f.call(`/api-keys/${key.id}`, "PATCH", { name: "Renamed" })
    )
    const audience = await response(
      "/audiences",
      "POST",
      await f.call("/audiences", "POST", { name: "Legacy audience" })
    )
    await response("/audiences", "GET", await f.call("/audiences"))
    await response(
      "/audiences/{id}",
      "GET",
      await f.call(`/audiences/${audience.id}`)
    )
    await response(
      "/audiences/{id}",
      "DELETE",
      await f.call(`/audiences/${audience.id}`, "DELETE")
    )
    const email = await response(
      "/emails",
      "POST",
      await f.call("/emails", "POST", {
        from: "hi@mail.example.test",
        to: "a@example.com",
        subject: "Attachment",
        html: "<p>Hi</p>",
        attachments: [{ filename: "a.txt", content: btoa("hello") }],
      })
    )
    const files = await response(
      "/emails/{id}/attachments",
      "GET",
      await f.call(`/emails/${email.id}/attachments`)
    )
    await response(
      "/emails/{id}/attachments/{attachmentId}",
      "GET",
      await f.call(`/emails/${email.id}/attachments/${files.data[0].id}`)
    )
    const broadcast = await response(
      "/broadcasts",
      "POST",
      await f.call("/broadcasts", "POST", {
        name: "Report",
        from: "hi@mail.example.test",
        subject: "Report",
        html: "<p>Hello</p>",
      })
    )
    const contact = await response(
      "/contacts",
      "POST",
      await f.call("/contacts", "POST", { email: "a@example.com" })
    )
    await f.t.run(async (ctx) => {
      await insertRow(ctx, "broadcastRecipients", {
        organizationId: f.owner.team,
        broadcastId: broadcast.id,
        contactId: contact.id,
        emailId: email.id,
        email: "a@example.com",
        settled: true,
        failed: false,
        sent: true,
      })
      await insertRow(ctx, "broadcastLinks", {
        organizationId: f.owner.team,
        broadcastId: broadcast.id,
        url: "https://example.com",
        clicks: 2,
        uniqueClicks: 1,
      })
    })
    await response(
      "/broadcasts/{id}/recipients",
      "GET",
      await f.call(`/broadcasts/${broadcast.id}/recipients?type=sent`)
    )
    await response(
      "/broadcasts/{id}/clicked-links",
      "GET",
      await f.call(`/broadcasts/${broadcast.id}/clicked-links`)
    )
    await f.t.mutation(components.betterAuth.oauthClients.register, {
      clientId: "contract",
      name: "Contract",
      redirects: ["https://client.example.com/callback"],
      scope: "full_access",
      method: "none",
    })
    await f.t.mutation(components.betterAuth.oauth.start, {
      token: "contract-flow",
      browserHash: "contract",
      query: new URLSearchParams({
        client_id: "contract",
        redirect_uri: "https://client.example.com/callback",
        scope: "full_access",
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }).toString(),
    })
    const grant = await f.t.mutation(components.betterAuth.oauth.decide, {
      token: "contract-flow",
      browserHash: "contract",
      sessionId: f.owner.session._id,
      organizationId: f.owner.team,
      accept: true,
    })
    await response("/oauth/grants", "GET", await f.call("/oauth/grants"))
    await response(
      "/oauth/grants/{id}",
      "DELETE",
      await f.call(`/oauth/grants/${grant.grantId}`, "DELETE")
    )
    // Validate the mode-dependent response using the same internal transaction as HTTP.
    const caller = await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("apiKeys")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .first()
      return {
        organizationId: f.owner.team,
        apiKeyId: row!._id,
        permission: "full_access" as const,
        name: "Contract",
      }
    })
    const batch = await f.t.mutation(internal.api.emails.batchSend, {
      caller,
      body: "[{}]",
      permissive: true,
    })
    validateBody(
      contract.paths["/emails/batch"].post.responses["200"].content[
        "application/json"
      ].schema,
      batch
    )
  })

  test("all webhook and suppression endpoints validate their real response bodies", async () => {
    vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
    const f = await setup()
    const hook = await response(
      "/webhooks",
      "POST",
      await f.call("/webhooks", "POST", {
        endpoint: "https://hooks.example.com/events",
        events: ["email.sent"],
      }),
      201
    )
    await response("/webhooks", "GET", await f.call("/webhooks"))
    await response(
      "/webhooks/{webhook_id}",
      "GET",
      await f.call(`/webhooks/${hook.id}`)
    )
    await response(
      "/webhooks/{webhook_id}",
      "PATCH",
      await f.call(`/webhooks/${hook.id}`, "PATCH", {
        events: ["email.sent", "suppression.added"],
      })
    )
    await response(
      "/webhooks/{webhook_id}/signing-secret/rotate",
      "POST",
      await f.call(`/webhooks/${hook.id}/signing-secret/rotate`, "POST")
    )
    const eventId = await f.t.run((ctx) =>
      ctx.db.insert("events", {
        organizationId: f.owner.team,
        type: "email.sent",
        data: { email_id: "mail" },
      })
    )
    await f.t.mutation(internal.webhooks.deliverEvent, { id: eventId })
    const events = await response(
      "/webhooks/{webhook_id}/events",
      "GET",
      await f.call(`/webhooks/${hook.id}/events`)
    )
    const id = events.data[0].id
    await response(
      "/webhooks/{webhook_id}/events/{event_id}",
      "GET",
      await f.call(`/webhooks/${hook.id}/events/${id}`)
    )
    await f.t.mutation(internal.webhooks.recordAttempt, {
      id,
      attempt: 0,
      status: 200,
      durationMs: 10,
      response: "OK",
    })
    await response(
      "/webhooks/{webhook_id}/events/{event_id}/attempts",
      "GET",
      await f.call(`/webhooks/${hook.id}/events/${id}/attempts`)
    )
    await response(
      "/webhooks/{webhook_id}/events/{event_id}/replay",
      "POST",
      await f.call(`/webhooks/${hook.id}/events/${id}/replay`, "POST")
    )
    await response(
      "/webhooks/{webhook_id}",
      "DELETE",
      await f.call(`/webhooks/${hook.id}`, "DELETE")
    )
    const suppression = await response(
      "/suppressions",
      "POST",
      await f.call("/suppressions", "POST", { email: "contract@example.com" }),
      201
    )
    await response("/suppressions", "GET", await f.call("/suppressions"))
    await response(
      "/suppressions/{suppression}",
      "GET",
      await f.call(`/suppressions/${suppression.id}`)
    )
    await response(
      "/suppressions/{suppression}",
      "DELETE",
      await f.call("/suppressions/contract%40example.com", "DELETE")
    )
    const batch = await response(
      "/suppressions/batch/add",
      "POST",
      await f.call("/suppressions/batch/add", "POST", {
        emails: ["batch@example.com"],
      }),
      201
    )
    await response(
      "/suppressions/batch/remove",
      "POST",
      await f.call("/suppressions/batch/remove", "POST", {
        ids: [batch.data[0].id],
      })
    )
  })

  test("response schemas reject missing required fields, wrong types and undocumented fields", () => {
    const schema =
      contract.paths["/contacts"].post.responses["201"].content[
        "application/json"
      ].schema
    const validate = ajv.compile(schema)
    expect(validate({ object: "contact" })).toBe(false)
    expect(validate({ object: "contact", id: 123 })).toBe(false)
    expect(
      validate({ object: "contact", id: "opaque", unexpected: true })
    ).toBe(false)
    expect(validate({ object: "contact", id: "opaque" })).toBe(true)
  })
})

test("GET /usage validates the self-hosted usage response", async () => {
  const { call } = await setup()
  const body = await response("/usage", "GET", await call("/usage"))
  expect(body).toMatchObject({
    object: "usage",
    emails: { daily: { limit: 200 }, monthly: { limit: null } },
    segments: { limit: null },
  })
})
