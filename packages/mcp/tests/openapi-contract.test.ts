import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { parse } from "yaml"
import { connectClient, baseUrl, fakeKey } from "./helpers/client.js"
import { toolNames } from "./helpers/tool-names.js"
import { USER_AGENT } from "../src/user-agent.js"

const spec = parse(
  readFileSync(
    new URL("../../../openapi/opensend.yaml", import.meta.url),
    "utf8"
  )
) as {
  paths: Record<string, Record<string, unknown>>
}
const operations = Object.entries(spec.paths).flatMap(([path, methods]) =>
  Object.keys(methods)
    .filter((m) => ["get", "post", "patch", "delete", "put"].includes(m))
    .map((method) => ({
      method: method.toUpperCase(),
      path,
      pattern: new RegExp("^" + path.replace(/\{[^}]+\}/g, "[^/]+") + "$"),
    }))
)
type Schema = {
  type?: string
  enum?: unknown[]
  const?: unknown
  format?: string
  anyOf?: Schema[]
  items?: Schema
  required?: string[]
  properties?: Record<string, Schema>
  minimum?: number
}
function sample(schema: Schema, key = ""): unknown {
  if (schema.const !== undefined) return schema.const
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf) return sample(schema.anyOf[0], key)
  if (schema.type === "object")
    return Object.fromEntries(
      (schema.required ?? []).map((k) => [k, sample(schema.properties![k], k)])
    )
  if (schema.type === "array") return [sample(schema.items!, key)]
  if (schema.type === "number" || schema.type === "integer")
    return schema.minimum ?? 1
  if (schema.type === "boolean") return true
  if (/email|from|^to$|replyTo/i.test(key) || schema.format === "email")
    return "person@example.com"
  if (/url|endpoint/i.test(key) || schema.format === "uri")
    return "https://example.com/hook"
  if (/scheduledAt/.test(key)) return "2030-01-01T00:00:00Z"
  return "test-id"
}
const workflow = {
  steps: [
    {
      key: "trigger",
      type: "trigger",
      config: { eventName: "test.event" },
      next: null,
    },
  ],
}
const overrides: Record<string, Record<string, unknown>> = {
  "batch-remove-suppressions": { ids: ["test-id"] },
  "place-whatsapp-call": {
    from: "number",
    contact_id: "lead",
    route: "bot:coach",
  },
  "request-contact-call-permission": { id: "lead", text: "May we call?" },
  "connect-whatsapp-call": { route: "gateway", recipient: "US.123" },
  "get-whatsapp-call-permissions": { recipient: "US.123" },
  "request-whatsapp-call-permission": {
    recipient: "US.123",
    text: "May we call?",
  },
  "send-email": { text: "Hello" },
  "send-messenger-message": { to: "psid", text: "Hello" },
  "send-instagram-message": { to: "igsid", text: "Hello" },
  "send-whatsapp-message": { to: "16505551234", text: "Hello" },
  "send-batch-emails": {
    emails: [
      {
        from: "sender@example.com",
        to: ["person@example.com"],
        subject: "Test",
        text: "Hello",
      },
    ],
  },
  "create-broadcast": { text: "Hello" },
  // html is optional in the schema, since WhatsApp templates have none.
  "create-template": { html: "<p>Hello</p>" },
  "create-contact-import": { content: "email\nperson@example.com" },
  "create-automation": { workflow },
  "update-automation": { workflow },
  "get-contact": { id: "test-id" },
  "update-contact": { id: "test-id", firstName: "Test" },
  "remove-contact": { id: "test-id" },
  "add-contact-to-segment": { contactId: "test-id" },
  "remove-contact-from-segment": { contactId: "test-id" },
  "list-contact-segments": { contactId: "test-id" },
  "list-contact-topics": { id: "test-id" },
  "update-contact-topics": { id: "test-id" },
  "send-event": { contactId: "test-id" },
  "manage-events": { name: "test.event" },
}
// Lane 5A owns these OpenAPI operations. Until integration, validate the
// new tools against the binding meta-wave5-contract.md rather than claiming
// these routes are already served on this branch.
const wave5Operations = [
  { method: "POST", pattern: /^\/(messenger|instagram)\/messages$/ },
  { method: "GET", pattern: /^\/(messenger|instagram)\/messages(?:\/[^/]+)?$/ },
  { method: "GET", pattern: /^\/messenger\/pages$/ },
  { method: "GET", pattern: /^\/instagram\/accounts$/ },
]
const expectedOperations = [...operations, ...wave5Operations]
// Real SDK requests are intercepted at fetch, never replaced by resource mocks.
// An API error is deliberate: it exercises dispatch and error propagation for
// every tool without inventing successful response bodies for 100+ operations.
describe("all registered tools use OpenAPI or the wave 5 binding contract", () => {
  let connection: Awaited<ReturnType<typeof connectClient>>
  let definitions: Map<string, Schema>
  let activeTool = ""
  const requests: Array<{ method: string; path: string }> = []
  beforeAll(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    connection = await connectClient()
    definitions = new Map(
      (await connection.client.listTools()).tools.map((t) => [
        t.name,
        t.inputSchema as Schema,
      ])
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString()
        )
        expect(url.origin).toBe(baseUrl)
        const headers = new Headers(init?.headers)
        expect(headers.get("authorization")).toBe("Bearer " + fakeKey)
        expect(headers.get("user-agent")).toBe(USER_AGENT)
        requests.push({ method: init?.method ?? "GET", path: url.pathname })
        if (activeTool === "update-broadcast" && init?.method === "GET") {
          return Response.json({
            id: "test-id",
            from: "sender@example.com",
            audience_id: "test-id",
          })
        }
        return Response.json(
          { name: "validation_error", message: "contract-test error" },
          { status: 422 }
        )
      })
    )
  })
  afterAll(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await connection.close()
  })
  it("covers the entire registry", () => {
    expect([...definitions.keys()].sort()).toEqual([...toolNames])
  })
  it.each(toolNames)("%s reaches its contracted route", async (name) => {
    requests.length = 0
    activeTool = name
    const args = {
      ...(sample(definitions.get(name)!) as Record<string, unknown>),
      ...overrides[name],
    }
    const result = await connection.client.callTool({ name, arguments: args })
    expect(requests.length, JSON.stringify(result)).toBeGreaterThan(0)
    for (const req of requests) {
      expect(
        expectedOperations.some(
          (op) => op.method === req.method && op.pattern.test(req.path)
        ),
        JSON.stringify(req)
      ).toBe(true)
      expect(req.path).not.toContain("/audiences/")
    }
    if (name === "update-broadcast")
      expect(requests.map((r) => r.method)).toEqual(["GET", "PATCH"])
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain("contract-test error")
  })
  const branches = [
    ...["list", "get", "update", "remove"].map((action) => ({
      name: "manage-events",
      args: { action, identifier: "test-id", schema: {} },
    })),
    { name: "get-automation", args: { id: "test-id" } },
    {
      name: "get-automation-runs",
      args: { automationId: "test-id", runId: "test-id" },
    },
    { name: "list-contacts", args: { segmentId: "test-id" } },
    ...[
      "get-contact",
      "update-contact",
      "remove-contact",
      "list-contact-topics",
      "update-contact-topics",
    ].map((name) => ({
      name,
      args: {
        email: "person@example.com",
        firstName: "Test",
        topics: [{ id: "test-id", subscription: "opt_in" }],
      },
    })),
    ...[
      "add-contact-to-segment",
      "remove-contact-from-segment",
      "list-contact-segments",
    ].map((name) => ({
      name,
      args: { email: "person@example.com", segmentId: "test-id" },
    })),
  ]
  it.each(branches)(
    "$name alternate operation: $args",
    async ({ name, args }) => {
      requests.length = 0
      activeTool = name
      const result = await connection.client.callTool({ name, arguments: args })
      expect(requests.length, JSON.stringify(result)).toBeGreaterThan(0)
      for (const req of requests)
        expect(
          expectedOperations.some(
            (op) => op.method === req.method && op.pattern.test(req.path)
          ),
          JSON.stringify(req)
        ).toBe(true)
      expect(JSON.stringify(result)).toContain("contract-test error")
    }
  )
})
