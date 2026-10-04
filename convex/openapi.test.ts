import { samplePayload } from "../lib/dashboard/automation"
// @vitest-environment node
import { callingRoutingSchema } from "../services/call-gateway/src/voice/routing"
import { resolve } from "node:path"
import SwaggerParser from "@apidevtools/swagger-parser"
import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020"
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
import { API_SCOPES, scopeName } from "../lib/api-scopes"
import type { ApiRouteOptions } from "./api/route"
import { api, components, internal } from "./_generated/api"
import { WEBHOOK_EVENTS } from "../lib/dashboard/types"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { upsertChannelThread } from "./channels/identity"
import { insertRow, patchRow } from "./counts"
import {
  inboundFixture,
  fakeGraph,
  graphError,
  incoming,
  signedWebhook,
  APP_SECRET,
  PHONE_ID,
  SENDER,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PAGE_ID,
  IG_ID,
  PSID,
  IGSID,
} from "./testHelpers/pages.fixture"
import type { Id } from "./_generated/dataModel"

const registrations = vi.hoisted(
  () =>
    [] as Pick<ApiRouteOptions, "method" | "path" | "scope" | "resolveScopes">[]
)
vi.mock("./api/route", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/route")>()
  return {
    ...actual,
    apiRoute: (...args: Parameters<typeof actual.apiRoute>) => {
      const { method, path, scope, resolveScopes } = args[1]
      registrations.push({ method, path, scope, resolveScopes })
      return actual.apiRoute(...args)
    },
  }
})
// Import the application entry, so registrations outside api/http.ts count too.
import http from "./http"

type Operation = {
  operationId: string
  "x-opensend-scope": string
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
// Fixtures reuse the same large schemas for many variants. Compile once per
// schema so testing every variant does not repeatedly rebuild the validator.
const validators = new Map<AnySchema, ValidateFunction>()
const validateBody = (schema: AnySchema, body: unknown) => {
  let validate = validators.get(schema)
  if (!validate) {
    validate = ajv.compile({
      ...(schema as Record<string, unknown>),
      components: {
        schemas: {
          EventPayloadField: contract.components.schemas.EventPayloadField,
          CatalogEvent: contract.components.schemas.CatalogEvent,
        },
      },
    })
    validators.set(schema, validate)
  }
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
    dereference: { circular: "ignore" },
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
  test("WhatsApp send, media and all read route responses validate against their schemas", async () => {
    vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
    const f = await inboundFixture()
    await f.t.run((ctx) =>
      patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
    )
    expect(
      (
        await f.t.fetch(
          "/meta/webhook",
          await signedWebhook(APP_SECRET, incoming())
        )
      ).status
    ).toBe(200)
    const event = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").first()
    )
    await f.t.mutation(internal.meta.projection.project, { id: event!._id })
    const { token } = await f.member.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: {
        name: "WhatsApp contract",
        permission: "full_access",
        domainId: null,
      },
    })
    const call = (path: string, method = "GET", body?: unknown) => {
      vi.setSystemTime(Date.now() + 1100)
      return f.t.fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    }
    const graph = fakeGraph([
      {
        path: `/${PHONE_ID}/messages`,
        respond: () => ({ messages: [{ id: "wamid.contract" }] }),
      },
      { path: `/${PHONE_ID}/media`, respond: () => ({ id: "media-contract" }) },
    ])
    const inboundMessage = await f.t.run((ctx) =>
      ctx.db.query("channelMessages").order("desc").first()
    )
    await response(
      "/whatsapp/messages/{id}/read",
      "POST",
      await call(`/whatsapp/messages/${inboundMessage!._id}/read`, "POST", {
        typing: true,
      })
    )
    await response(
      "/whatsapp/messages/{id}/read",
      "POST",
      await call(`/whatsapp/messages/${inboundMessage!._id}/read`, "POST", {}),
      202
    )
    await response(
      "/whatsapp/messages/{id}",
      "GET",
      await call(`/whatsapp/messages/${inboundMessage!._id}`)
    )
    await response(
      "/whatsapp/conversations/{id}/typing",
      "POST",
      await call(
        `/whatsapp/conversations/${inboundMessage!.conversationId}/typing`,
        "POST",
        { on: true }
      ),
      202
    )
    const body = { to: SENDER, text: { body: "Contract", preview_url: true } }
    validateBody(contract.components.schemas.SendWhatsAppMessage, body)
    validateBody(contract.components.schemas.SendWhatsAppMessage, {
      to: SENDER,
      template: { name: "hello", language: "en", variables: { "1": "Ada" } },
    })
    const unified = await response(
      "/messages",
      "POST",
      await call("/messages", "POST", {
        channel: "whatsapp",
        to: SENDER,
        text: "Unified contract",
      })
    )
    await response(
      "/messages/{id}",
      "GET",
      await call(`/messages/${unified.id}`)
    )
    await response("/messages", "GET", await call("/messages?channel=whatsapp"))
    const sent = await response(
      "/whatsapp/messages",
      "POST",
      await call("/whatsapp/messages", "POST", body)
    )
    await f.t.action(internal.channels.deliver.deliver, {
      id: sent.id,
      generation: 0,
    })
    const detail = await response(
      "/whatsapp/messages/{id}",
      "GET",
      await call(`/whatsapp/messages/${sent.id}`)
    )
    expect(detail).toMatchObject({
      status: "sent",
      text: "Contract",
      external_id: "wamid.contract",
    })
    await response(
      "/whatsapp/messages",
      "GET",
      await call("/whatsapp/messages?status=sent")
    )
    await response(
      "/whatsapp/phone-numbers",
      "GET",
      await call("/whatsapp/phone-numbers")
    )
    await response(
      "/whatsapp/phone-numbers/{id}",
      "GET",
      await call(`/whatsapp/phone-numbers/${PHONE_ID}`)
    )
    await response(
      "/whatsapp/conversations",
      "GET",
      await call("/whatsapp/conversations")
    )
    await response(
      "/whatsapp/conversations/{id}/messages",
      "GET",
      await call(`/whatsapp/conversations/${detail.conversation_id}/messages`)
    )
    const form = new FormData()
    form.append(
      "file",
      new Blob([new Uint8Array([255, 0, 128])], { type: "image/png" }),
      "file.png"
    )
    vi.setSystemTime(Date.now() + 1100)
    await response(
      "/whatsapp/media",
      "POST",
      await f.t.fetch("/whatsapp/media", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
    )
    for (const [code, status] of [
      [130429, 503],
      [100, 422],
      [0, 502],
    ]) {
      graph.use({
        path: `/${PHONE_ID}/media`,
        respond: () => (code ? graphError("Meta upload refused", code) : {}),
      })
      vi.setSystemTime(Date.now() + 1100)
      await response(
        "/whatsapp/media",
        "POST",
        await f.t.fetch("/whatsapp/media", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        }),
        status
      )
    }
    await response(
      "/whatsapp/messages",
      "POST",
      await call("/whatsapp/messages", "POST", {
        to: "16505550000",
        text: "Closed",
      }),
      422
    )
    await response(
      "/whatsapp/messages/{id}",
      "GET",
      await call("/whatsapp/messages/missing"),
      404
    )
  })

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

  test("is OpenAPI 3.1 and exactly covers every registered REST method/path and scope", () => {
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
      "GET /channels/media/*",
      "GET /ses/health",
      "POST /ses/events",
      "POST /ses/inbound",
      "GET /meta/webhook",
      "POST /meta/webhook",
      "POST /calling/gateway/events",
      // Browser disconnect capability, outside the key-authenticated REST API.
      "POST /calling/softphone/leave",
      "POST /calling/gateway/ivr/start",
      "POST /calling/gateway/ivr/next",
      "GET /calling/ivr/audio/*",
      "POST /calling/gateway/voice/session",
      "POST /calling/gateway/voice/tools",
      "POST /calling/gateway/voice/events",
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
    for (const { path, method, scope } of registrations) {
      expect(scope).toBeDefined()
      expect(
        contract.paths[path][method.toLowerCase()]["x-opensend-scope"]
      ).toBe(scopeName(scope))
      if (scope !== "full_access")
        expect(scope.access).toBe(
          method === "GET" ||
            path === "/ivrs/{id}/validate" ||
            path === "/knowledge-bases/{id}/search"
            ? "read"
            : "write"
        )
    }
    const ids = Object.values(contract.paths).flatMap((ops) =>
      Object.values(ops).map((op) => op.operationId)
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  test("every registered route declares a catalog scope and API key scopes match the catalog", () => {
    for (const { scope } of registrations) {
      expect(scope).toBeDefined()
      expect(
        scope === "full_access" ||
          API_SCOPES.includes(scopeName(scope) as (typeof API_SCOPES)[number])
      ).toBe(true)
    }
    expect(contract.components.schemas.ApiScope).toMatchObject({
      enum: API_SCOPES,
    })
  })

  test("all request/response schemas compile as JSON Schema 2020-12", () => {
    for (const methods of Object.values(contract.paths))
      for (const operation of Object.values(methods)) {
        if (operation.requestBody)
          for (const media of Object.values(operation.requestBody.content))
            ajv.compile({
              ...(media.schema as Record<string, unknown>),
              components: {
                schemas: {
                  EventPayloadField:
                    contract.components.schemas.EventPayloadField,
                  CatalogEvent: contract.components.schemas.CatalogEvent,
                },
              },
            })
        for (const result of Object.values(operation.responses))
          ajv.compile({
            ...(result.content["application/json"].schema as Record<
              string,
              unknown
            >),
            components: {
              schemas: {
                EventPayloadField:
                  contract.components.schemas.EventPayloadField,
                CatalogEvent: contract.components.schemas.CatalogEvent,
              },
            },
          })
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

  test("phone-only contact requests and nullable responses match the contract", async () => {
    const f = await setup()
    validateBody(contract.components.schemas.CreateContactOptions, {
      phone: "+14155552671",
    })
    const { id } = await response(
      "/contacts",
      "POST",
      await f.call("/contacts", "POST", { phone: "+14155552671" })
    )
    expect(
      await response("/contacts/{id}", "GET", await f.call(`/contacts/${id}`))
    ).toMatchObject({ email: null, phone: "+14155552671", properties: {} })
    await response("/contacts", "GET", await f.call("/contacts"))
    await response(
      "/contacts/{id}",
      "PATCH",
      await f.call(`/contacts/${id}`, "PATCH", {
        email: "phone@example.test",
        phone: null,
      })
    )
    expect(
      await response("/contacts/{id}", "GET", await f.call(`/contacts/${id}`))
    ).toMatchObject({ email: "phone@example.test", phone: null })
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

  test("WhatsApp template requests and responses match the contract", async () => {
    const f = await setup()
    await f.t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("metaConnections", {
        organizationId: f.owner.team,
        businessId: "business",
        businessName: "Contract",
        method: "manual_token",
        encryptedToken: "unused",
        tokenLast4: "used",
        scopes: [],
        status: "active",
      })
      await ctx.db.insert("whatsappBusinessAccounts", {
        organizationId: f.owner.team,
        wabaId: "102290129340398",
        connectionId,
      })
    })
    const request = {
      name: "order_shipped",
      channel: "whatsapp",
      whatsapp: {
        language: "en_US",
        category: "UTILITY",
        parameter_format: "named",
        components: [
          {
            type: "BODY",
            text: "Hi {{first_name}}, your order has shipped.",
            example: {
              body_text_named_params: [
                { param_name: "first_name", example: "Pablo" },
              ],
            },
          },
        ],
      },
    }
    const create = contract.paths["/templates"].post
    validateBody(
      create.requestBody!.content["application/json"].schema,
      request
    )
    const { id } = await response(
      "/templates",
      "POST",
      await f.call("/templates", "POST", request)
    )
    const got = await response(
      "/templates/{id}",
      "GET",
      await f.call(`/templates/${id}`)
    )
    expect(got).toMatchObject({
      channel: "whatsapp",
      whatsapp: { parameter_format: "named", status: null },
      variables: [{ key: "first_name", fallback_value: null }],
    })
    const list = await response(
      "/templates",
      "GET",
      await f.call("/templates?channel=whatsapp")
    )
    expect(list.data).toHaveLength(1)
    const update = { whatsapp: { category: "MARKETING" } }
    validateBody(
      contract.paths["/templates/{id}"].patch.requestBody!.content[
        "application/json"
      ].schema,
      update
    )
    await response(
      "/templates/{id}",
      "PATCH",
      await f.call(`/templates/${id}`, "PATCH", update)
    )
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
    expect(missing.name).toBe("validation_error")
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
    const validate = ajv.compile({
      ...(schema as Record<string, unknown>),
      components: {
        schemas: {
          EventPayloadField: contract.components.schemas.EventPayloadField,
          CatalogEvent: contract.components.schemas.CatalogEvent,
        },
      },
    })
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

test("webhook event subscriptions use the shared catalogue including WhatsApp", () => {
  const eventType = contract.components.schemas.WebhookEventType
  expect(typeof eventType === "object" && eventType.enum).toEqual([
    ...WEBHOOK_EVENTS,
  ])
})

test("Messenger and Instagram send, read routes and local templates validate real responses with Ajv", async () => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "contract-pages-encryption-".repeat(3))
  fakeGraph(pageGraphRoutes())
  const f = await pagesFixture()
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "Page contracts",
      permission: "full_access",
      domainId: null,
    },
  })
  const call = (path: string, method = "GET", body?: unknown) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  for (const channel of ["messenger", "instagram"] as const) {
    await f.t.fetch(
      "/meta/webhook",
      await signedWebhook(
        APP_SECRET,
        pageEnvelope(channel, {
          message: { mid: `mid.contract.${channel}`, text: "Hello" },
        })
      )
    )
    const event = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").order("desc").first()
    )
    await f.t.mutation(internal.meta.projection.project, { id: event!._id })
    const inboundMessage = await f.t.run((ctx) =>
      ctx.db.query("channelMessages").order("desc").first()
    )
    await response(
      `/${channel}/messages/{id}/read`,
      "POST",
      await call(`/${channel}/messages/${inboundMessage!._id}/read`, "POST", {
        typing: true,
      })
    )
    await response(
      `/${channel}/messages/{id}/read`,
      "POST",
      await call(
        `/${channel}/messages/${inboundMessage!._id}/read`,
        "POST",
        {}
      ),
      202
    )
    await response(
      `/${channel}/messages/{id}`,
      "GET",
      await call(`/${channel}/messages/${inboundMessage!._id}`)
    )
    await response(
      `/${channel}/conversations/{id}/typing`,
      "POST",
      await call(
        `/${channel}/conversations/${inboundMessage!.conversationId}/typing`,
        "POST",
        { on: false }
      ),
      202
    )
    vi.advanceTimersByTime(5000)
    await response(
      `/${channel}/conversations/{id}/typing`,
      "POST",
      await call(
        `/${channel}/conversations/${inboundMessage!.conversationId}/typing`,
        "POST",
        { on: false }
      )
    )
    const to = channel === "messenger" ? PSID : IGSID,
      resource = channel === "messenger" ? "pages" : "accounts",
      externalId = channel === "messenger" ? PAGE_ID : IG_ID
    const unified = await response(
      "/messages",
      "POST",
      await call("/messages", "POST", {
        channel,
        to,
        text: "Unified page contract",
      })
    )
    await response(
      "/messages/{id}",
      "GET",
      await call(`/messages/${unified.id}`)
    )
    await response(
      "/messages",
      "GET",
      await call(`/messages?channel=${channel}`)
    )
    const request = {
      to,
      text: "Reply",
      quick_replies: [{ title: "Yes", payload: "YES" }],
    }
    validateBody(
      contract.paths[`/${channel}/messages`].post.requestBody!.content[
        "application/json"
      ].schema,
      request
    )
    const { id } = await response(
      `/${channel}/messages`,
      "POST",
      await call(`/${channel}/messages`, "POST", request)
    )
    const detail = await response(
      `/${channel}/messages/{id}`,
      "GET",
      await call(`/${channel}/messages/${id}`)
    )
    expect(detail).toMatchObject({
      channel,
      text: "Reply",
      last_event: "queued",
    })
    await response(
      `/${channel}/messages`,
      "GET",
      await call(`/${channel}/messages`)
    )
    await response(
      `/${channel}/${resource}`,
      "GET",
      await call(`/${channel}/${resource}`)
    )
    await response(
      `/${channel}/${resource}/{id}`,
      "GET",
      await call(`/${channel}/${resource}/${externalId}`)
    )
    await response(
      `/${channel}/conversations`,
      "GET",
      await call(`/${channel}/conversations`)
    )
    await response(
      `/${channel}/conversations/{id}/messages`,
      "GET",
      await call(`/${channel}/conversations/${detail.conversation_id}/messages`)
    )
    const templateRequest = {
      channel,
      name: `${channel} welcome`,
      text: "Hello {{{name}}}",
      quick_replies: [{ title: "Yes", payload: "YES" }],
    }
    validateBody(
      contract.components.schemas.CreateTemplateRequest,
      templateRequest
    )
    const template = await response(
      "/templates",
      "POST",
      await call("/templates", "POST", templateRequest)
    )
    await response(
      "/templates/{id}",
      "GET",
      await call(`/templates/${template.id}`)
    )
    await response(
      "/templates",
      "GET",
      await call(`/templates?channel=${channel}`)
    )
    await response(
      "/templates/{id}/publish",
      "POST",
      await call(`/templates/${template.id}/publish`, "POST", {})
    )
    const accountId = f.accounts.find((a) => a.channel === channel)!.id
    const broadcastRequest = {
      channel,
      messaging: {
        account_id: accountId,
        template_id: template.id,
        variables: { name: { value: "Friend" } },
      },
      name: `${channel} broadcast`,
    }
    validateBody(
      contract.components.schemas.CreateBroadcastOptions,
      broadcastRequest
    )
    const broadcast = await response(
      "/broadcasts",
      "POST",
      await call("/broadcasts", "POST", broadcastRequest)
    )
    const broadcastDetail = await response(
      "/broadcasts/{id}",
      "GET",
      await call(`/broadcasts/${broadcast.id}`)
    )
    expect(broadcastDetail).toMatchObject({
      channel,
      messaging: broadcastRequest.messaging,
    })
    await response("/broadcasts", "GET", await call("/broadcasts"))
    const update = {
      channel,
      messaging: {
        ...broadcastRequest.messaging,
        variables: { name: { value: "Updated" } },
      },
    }
    validateBody(contract.components.schemas.UpdateBroadcastOptions, update)
    await response(
      "/broadcasts/{id}",
      "PATCH",
      await call(`/broadcasts/${broadcast.id}`, "PATCH", update)
    )
    expect(
      (
        await response(
          "/broadcasts/{id}",
          "GET",
          await call(`/broadcasts/${broadcast.id}`)
        )
      ).messaging
    ).toEqual(update.messaging)
    const duplicate = await response(
      "/broadcasts/{id}/duplicate",
      "POST",
      await call(`/broadcasts/${broadcast.id}/duplicate`, "POST", {})
    )
    expect(
      (
        await response(
          "/broadcasts/{id}",
          "GET",
          await call(`/broadcasts/${duplicate.id}`)
        )
      ).channel
    ).toBe(channel)
    const rendered = await response(
      "/messages",
      "POST",
      await call("/messages", "POST", {
        channel,
        to,
        template: { id: template.id, variables: { name: "Ada" } },
      })
    )
    const renderedMessage = await response(
      "/messages/{id}",
      "GET",
      await call(`/messages/${rendered.id}`)
    )
    expect(renderedMessage.preview).toBe("Hello Ada")
  }
})

test("WhatsApp catalog request, response and customer webhook examples validate per type", async () => {
  const { whatsappSendExamples, whatsappInboundExamples } =
    await import("../lib/meta/whatsapp-fixtures")
  const { readFileSync } = await import("node:fs")
  // The dereferenced contract retains examples as well as the schema.
  type ExamplesContent = {
    schema: AnySchema
    examples: Record<string, { value: unknown }>
  }
  const operation = contract.paths["/whatsapp/messages"].post
  const requests = operation.requestBody!.content[
    "application/json"
  ] as ExamplesContent
  const responses = contract.paths["/whatsapp/messages/{id}"].get.responses[
    "200"
  ].content["application/json"] as ExamplesContent
  for (const name of Object.keys(whatsappSendExamples)) {
    expect(requests.examples[name], name).toBeDefined()
    validateBody(requests.schema, requests.examples[name].value)
    validateBody(responses.schema, responses.examples[`sent_${name}`].value)
  }
  validateBody(requests.schema, requests.examples.bsuid.value)
  for (const name of Object.keys(whatsappInboundExamples))
    validateBody(responses.schema, responses.examples[name].value)
  const source = readFileSync(resolve("openapi/opensend.yaml"), "utf8")
  expect(source).toContain("whatsapp.message.played")
  const webhook = (
    contract as Contract & {
      webhooks: {
        whatsappMessage: {
          post: {
            requestBody: { content: { "application/json": ExamplesContent } }
          }
        }
      }
    }
  ).webhooks.whatsappMessage.post.requestBody.content["application/json"]
  for (const name of [
    ...Object.keys(whatsappSendExamples).map((n) => `sent_${n}`),
    ...Object.keys(whatsappInboundExamples),
  ]) {
    expect(webhook.examples[name], name).toBeDefined()
    validateBody(webhook.schema, webhook.examples[name].value)
  }
})

test("calling REST settings, permissions, lifecycle and idempotent connect validate real response schemas", async () => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "calling-contract-key-".repeat(3))
  vi.stubEnv("CALL_GATEWAY_URL", "")
  vi.stubEnv("CALL_GATEWAY_SECRET", "")
  const { CALLING_TEST_SDP: sdp } = await import("../lib/meta/calling-fixtures")
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "Calling contract",
      permission: "full_access",
      domainId: null,
    },
  })
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    idempotencyKey?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  const calling = {
    status: "ENABLED",
    call_icon_visibility: "DEFAULT",
    call_hours: { status: "DISABLED" },
  }
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/settings`,
      method: "GET",
      respond: () => ({ calling }),
    },
    {
      path: `/${PHONE_ID}/settings`,
      method: "POST",
      respond: () => ({ success: true }),
    },
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        messaging_product: "whatsapp",
        permission: { status: "granted" },
        actions: [],
      }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: (c) =>
        (c.body as { action: string }).action === "connect"
          ? { calls: [{ id: "wacid.contract" }] }
          : { success: true },
    },
  ])
  await response(
    "/whatsapp/phone-numbers/{id}/calling",
    "POST",
    await call(`/whatsapp/phone-numbers/${PHONE_ID}/calling`, "POST", {
      calling,
      handling_mode: "api",
    })
  )
  await response(
    "/whatsapp/phone-numbers/{id}/calling",
    "GET",
    await call(`/whatsapp/phone-numbers/${PHONE_ID}/calling`)
  )
  await response(
    "/whatsapp/call-permissions",
    "GET",
    await call("/whatsapp/call-permissions?recipient=US.42")
  )
  const input = {
    recipient: "US.42",
    route: "api",
    session: { sdp_type: "offer", sdp },
  }
  validateBody(contract.components.schemas.ConnectWhatsAppCall, input)
  const created = await response(
    "/whatsapp/calls",
    "POST",
    await call("/whatsapp/calls", "POST", input, "connect-contract")
  )
  expect(
    await response(
      "/whatsapp/calls",
      "POST",
      await call("/whatsapp/calls", "POST", input, "connect-contract")
    )
  ).toEqual(created)
  expect(graph.to(`/${PHONE_ID}/calls`)).toHaveLength(1)
  await response("/whatsapp/calls", "GET", await call("/whatsapp/calls"))
  await response(
    "/whatsapp/calls/{id}",
    "GET",
    await call(`/whatsapp/calls/${created.id}`)
  )
  await response(
    "/whatsapp/calls/{id}/terminate",
    "POST",
    await call(`/whatsapp/calls/${created.id}/terminate`, "POST", {})
  )
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", "c".repeat(64))
  const ivr = await response(
    "/ivrs",
    "POST",
    await call("/ivrs", "POST", {
      name: "Follow up",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "tts", text: "Press one" },
          options: { "1": { kind: "hangup" } },
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
        },
      ],
    }),
    201
  )
  const contact = await f.t.run(async (ctx) =>
    upsertChannelThread(
      ctx,
      (await ctx.db.get("channelAccounts", f.account))!,
      {
        externalId: "919999000022",
        phone: "+919999000022",
        at: Date.now(),
        direction: "inbound",
        preview: "Signup",
        opensWindow: true,
      }
    )
  )
  graph.use({
    path: `/${PHONE_ID}/call_permissions`,
    respond: () => ({
      permission: { status: "no_permission" },
      actions: [
        { action_name: "start_call", can_perform_action: false },
        {
          action_name: "send_call_permission_request",
          can_perform_action: true,
        },
      ],
    }),
  })
  const managedInput = {
    from: f.account,
    contact_id: contact.contactId,
    route: `ivr:${ivr.id}`,
    context: "Seminar follow-up",
    variables: { seminar: "Saturday" },
  }
  validateBody(contract.components.schemas.ConnectWhatsAppCall, managedInput)
  expect(
    await response(
      "/whatsapp/calls",
      "POST",
      await call("/whatsapp/calls", "POST", managedInput)
    )
  ).toMatchObject({ status: "permission_required" })
  const queued = await response(
    "/whatsapp/calls",
    "POST",
    await call(
      "/whatsapp/calls",
      "POST",
      { ...managedInput, request_permission: true },
      "permission-contract"
    )
  )
  expect(queued).toMatchObject({
    status: "permission_requested",
    permission_request_id: expect.any(String),
  })
  expect(
    await response(
      "/whatsapp/calls",
      "POST",
      await call(
        "/whatsapp/calls",
        "POST",
        { ...managedInput, request_permission: true },
        "permission-contract"
      )
    )
  ).toEqual(queued)
  await response(
    "/contacts/{id}/call-permission",
    "GET",
    await call(
      `/contacts/${contact.contactId}/call-permission?from=${f.account}`
    )
  )
  const second = await f.t.run(async (ctx) =>
    upsertChannelThread(
      ctx,
      (await ctx.db.get("channelAccounts", f.account))!,
      {
        externalId: "919999000033",
        phone: "+919999000033",
        at: Date.now(),
        direction: "inbound",
        preview: "Signup",
        opensWindow: true,
      }
    )
  )
  await response(
    "/contacts/{id}/call-permission",
    "POST",
    await call(`/contacts/${second.contactId}/call-permission`, "POST", {
      from: f.account,
      text: "May we call?",
    })
  )
  validateBody(contract.components.schemas.PlaceCallStepConfig, {
    account_id: f.account,
    route: `ivr:${ivr.id}`,
    variables: { seminar: { var: "event.seminar" } },
    request_permission: true,
  })
})

test("IVR definitions, dry-run validation and customer completion sample validate against the public schemas", async () => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
  const f = await fixture()
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "IVR schema", permission: "full_access", domainId: null },
  })
  const call = (path: string, method = "GET", body?: unknown) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const input = {
    name: "Reception",
    language: "en",
    entryMenuId: "main",
    menus: [
      {
        id: "main",
        name: "Main",
        prompt: { kind: "tts", text: "Press one" },
        options: { "1": { kind: "voicemail" } },
        noInputAction: { kind: "hangup" },
        failureAction: { kind: "hangup" },
      },
    ],
  }
  const created = await response(
    "/ivrs",
    "POST",
    await call("/ivrs", "POST", input),
    201
  )
  await response("/ivrs", "GET", await call("/ivrs"))
  await response("/ivrs/{id}", "GET", await call(`/ivrs/${created.id}`))
  await response(
    "/ivrs/{id}",
    "PATCH",
    await call(`/ivrs/${created.id}`, "PATCH", { name: "Updated" })
  )
  await response(
    "/ivrs/{id}/validate",
    "POST",
    await call(`/ivrs/${created.id}/validate`, "POST", {
      entryMenuId: "missing",
    })
  )
  await response(
    "/ivrs/{id}",
    "DELETE",
    await call(`/ivrs/${created.id}`, "DELETE")
  )
  const spec = contract as unknown as {
    webhooks: {
      whatsappCallIvrCompleted: {
        post: {
          requestBody: {
            content: {
              "application/json": { schema: AnySchema; example: unknown }
            }
          }
        }
      }
    }
  }
  const sample =
    spec.webhooks.whatsappCallIvrCompleted.post.requestBody.content[
      "application/json"
    ]
  validateBody(sample.schema, sample.example)
})

test("calling routing contract derives all four targets from the shared definition", () => {
  expect(contract.components.schemas.CallingRouting).toEqual(
    callingRoutingSchema
  )
})

test("contact note CRUD, cursors, idempotency and webhook sample match the public contract", async () => {
  vi.stubEnv(
    "SSO_ENCRYPTION_KEY",
    "contact-notes-fixture-encryption-".repeat(3)
  )
  const f = await setup()
  const contact = await response(
    "/contacts",
    "POST",
    await f.call("/contacts", "POST", { email: "notes@example.test" })
  )
  const secondContact = await response(
    "/contacts",
    "POST",
    await f.call("/contacts", "POST", { email: "second@example.test" })
  )
  const path = `/contacts/${contact.id}/notes`
  const contractPath = "/contacts/{id}/notes"
  const itemPath = "/contacts/{id}/notes/{note_id}"
  const first = await response(
    contractPath,
    "POST",
    await f.call(path, "POST", {
      body: "First\nplain text",
      author: { kind: "bot", name: "Spoof" },
    }),
    201
  )
  expect(first).toMatchObject({
    body: "First\nplain text",
    contact_id: contact.id,
    author: { kind: "api", name: "API key “Contract”" },
    source: null,
  })
  const second = await response(
    contractPath,
    "POST",
    await f.call(path, "POST", { body: "Second" }),
    201
  )
  const page = await response(
    contractPath,
    "GET",
    await f.call(`${path}?limit=1`)
  )
  expect(page.has_more).toBe(true)
  expect(page.data.map((note: { id: string }) => note.id)).toEqual([second.id])
  const older = await response(
    contractPath,
    "GET",
    await f.call(`${path}?after=${second.id}`)
  )
  expect(older.data.map((note: { id: string }) => note.id)).toEqual([first.id])
  const newer = await response(
    contractPath,
    "GET",
    await f.call(`${path}?before=${first.id}`)
  )
  expect(newer.data.map((note: { id: string }) => note.id)).toEqual([second.id])
  const edited = await response(
    itemPath,
    "PATCH",
    await f.call(`${path}/${first.id}`, "PATCH", {
      body: "Edited",
      author: { kind: "bot" },
    })
  )
  expect(edited.author).toEqual(first.author)
  expect(edited.created_at).toEqual(first.created_at)
  expect(edited.updated_at > first.updated_at).toBe(true)
  expect(edited.body).toBe("Edited")
  await response(
    itemPath,
    "DELETE",
    await f.call(`${path}/${second.id}`, "DELETE")
  )
  await response(
    itemPath,
    "PATCH",
    await f.call(`${path}/${second.id}`, "PATCH", { body: "Gone" }),
    404
  )
  for (const body of [
    {},
    { body: 7 },
    { body: " \n" },
    { body: "x".repeat(10001) },
  ])
    await response(contractPath, "POST", await f.call(path, "POST", body), 422)
  await response(
    itemPath,
    "DELETE",
    await f.call(`/contacts/${secondContact.id}/notes/${first.id}`, "DELETE"),
    404
  )
  await response(
    contractPath,
    "GET",
    await f.call(`/contacts/${secondContact.id}/notes?after=${first.id}`),
    422
  )
  const foreign = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Foreign", permission: "full_access", domainId: null },
  })
  for (const [url, method, input] of [
    [path, "GET", undefined],
    [path, "POST", { body: "Foreign" }],
    [`${path}/${first.id}`, "PATCH", { body: "Foreign" }],
    [`${path}/${first.id}`, "DELETE", undefined],
  ] as const)
    await response(
      method === "POST" || method === "GET" ? contractPath : itemPath,
      method,
      await f.call(url, method, input, foreign.token),
      404
    )
  const key = async (scope: string) =>
    f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: {
        name: scope,
        permission: "custom",
        scopes: [scope],
        domainId: null,
      },
    })
  const read = await key("contacts:read")
  const write = await key("contacts:write")
  const unrelated = await key("events:write")
  await response(
    contractPath,
    "GET",
    await f.call(path, "GET", undefined, read.token)
  )
  await response(
    contractPath,
    "POST",
    await f.call(path, "POST", { body: "Denied" }, read.token),
    403
  )
  await response(
    itemPath,
    "PATCH",
    await f.call(
      `${path}/${first.id}`,
      "PATCH",
      { body: "Denied" },
      read.token
    ),
    403
  )
  await response(
    itemPath,
    "DELETE",
    await f.call(`${path}/${first.id}`, "DELETE", undefined, read.token),
    403
  )
  await response(
    contractPath,
    "GET",
    await f.call(path, "GET", undefined, unrelated.token),
    403
  )
  const authorized = await response(
    contractPath,
    "POST",
    await f.call(path, "POST", { body: "Authorized" }, write.token),
    201
  )
  await response(
    itemPath,
    "PATCH",
    await f.call(
      `${path}/${authorized.id}`,
      "PATCH",
      { body: "Authorized edit" },
      write.token
    )
  )
  await response(
    itemPath,
    "DELETE",
    await f.call(`${path}/${authorized.id}`, "DELETE", undefined, write.token)
  )
  const once = () => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${write.token}`,
        "content-type": "application/json",
        "idempotency-key": "contact-note-once",
      },
      body: JSON.stringify({ body: "Once" }),
    })
  }
  const created = await response(contractPath, "POST", await once(), 201)
  expect(await response(contractPath, "POST", await once(), 201)).toEqual(
    created
  )
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .filter((q) => q.eq(q.field("type"), "contact.note_created"))
      .collect()
  )
  expect(events.filter((e) => e.data.id === created.id)).toHaveLength(1)
  const event = events.find((e) => e.data.id === created.id)!
  const hook = await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://example.com/notes",
    events: ["contact.note_created"],
  })
  await f.t.mutation(internal.webhooks.deliverEvent, { id: event._id })
  const delivery = await f.t.run((ctx) =>
    ctx.db.query("webhookDeliveries").first()
  )
  expect(delivery).toMatchObject({
    event: "contact.note_created",
    payload: { data: created },
  })
  expect(hook).toBeDefined()
  const spec = contract as unknown as {
    webhooks: {
      contactNoteCreated: {
        post: {
          requestBody: {
            content: {
              "application/json": { schema: AnySchema; example: unknown }
            }
          }
        }
      }
    }
  }
  const sample =
    spec.webhooks.contactNoteCreated.post.requestBody.content[
      "application/json"
    ]
  validateBody(sample.schema, sample.example)
  validateBody(sample.schema, delivery!.payload)
  validateBody(
    contract.components.schemas.ContactNote,
    samplePayload({ name: "contact.note_created", schema: [] })
  )
})

test("unified messages validate actual email responses and document dynamic channel authorization", async () => {
  const f = await setup()
  const created = await response(
    "/messages",
    "POST",
    await f.call("/messages", "POST", {
      channel: "email",
      from: "sender@mail.example.test",
      to: "person@example.test",
      subject: "Unified contract",
      text: "Unified body",
    })
  )
  const message = await response(
    "/messages/{id}",
    "GET",
    await f.call(`/messages/${created.id}`)
  )
  expect(message).toMatchObject({
    object: "message",
    channel: "email",
    direction: "outbound",
    preview: "Unified body",
    contact_id: null,
  })
  await response(
    "/messages",
    "GET",
    await f.call("/messages?channel=email&direction=outbound")
  )
  const post = registrations.find(
    (r) => r.path === "/messages" && r.method === "POST"
  )!
  for (const channel of ["email", "whatsapp", "messenger", "instagram"]) {
    expect(
      post.resolveScopes!({ body: { channel }, query: new URLSearchParams() })
    ).toEqual([
      { resource: channel === "email" ? "emails" : channel, access: "write" },
    ])
    validateBody(contract.components.schemas.SendMessage, {
      channel,
      to: "recipient",
      text: "Hello",
    })
  }
  expect(
    (contract.paths["/messages"].post as unknown as Record<string, unknown>)[
      "x-opensend-dynamic-scope"
    ]
  ).toBe("channel:write")
})

test("shared webhook schema documents additive message fields and legacy email fields", () => {
  const hook = (
    contract as unknown as {
      webhooks: {
        message: {
          post: {
            requestBody: {
              content: {
                "application/json": { schema: AnySchema; example: unknown }
              }
            }
          }
        }
      }
    }
  ).webhooks.message.post.requestBody.content["application/json"]
  validateBody(hook.schema, hook.example)
})
