import * as embeddingNet from "../services/call-gateway/src/net/public-fetch"
import SwaggerParser from "@apidevtools/swagger-parser"
import Ajv2020 from "ajv/dist/2020"
import { resolve } from "node:path"
// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import {
  saveCollectedField,
  completeCollection,
  inferCollectedFields,
} from "./voice/collection"
import { encryptSecret } from "./secrets"
import { validateBot } from "../lib/voice-bots"
import { knowledgeScope as scope } from "../lib/bot-toolkit"
import type { Id } from "./_generated/dataModel"
import type { KnowledgeMatch } from "./knowledge/search"
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "toolkit-fixture-encryption-key-".repeat(3))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await inboundFixture()
  const organizationId = f.owner.team
  const credentialId = await f.t.run(async (ctx) =>
    ctx.db.insert("voiceProviders", {
      organizationId,
      provider: "gemini",
      label: "Knowledge",
      encryptedKey: await encryptSecret("sk_fixture_not_a_real_key"),
      lastFour: "_key",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  const base = await f.owner.client.action(
    api.knowledge.resources.dashboardWrite,
    { organizationId, body: JSON.stringify({ name: "Manual" }) }
  )
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId,
    input: { name: "Toolkit", permission: "full_access", domainId: null },
  })
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    token = key.token
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  const doc = async (text = "The office opens at nine.") => {
    const result = await f.owner.client.action(
      api.knowledge.resources.dashboardWrite,
      {
        organizationId,
        knowledgeBaseId: base.id,
        body: JSON.stringify({ title: "Hours", source: "text", text }),
      }
    )
    return (await f.t.run((ctx) =>
      ctx.db.get("knowledgeDocuments", result.id as Id<"knowledgeDocuments">)
    ))!
  }
  return {
    ...f,
    organizationId,
    credentialId,
    baseId: base.id as Id<"knowledgeBases">,
    request,
    doc,
  }
}
test("knowledge ingestion uses team credentials, atomically replaces revisions and reports real failures", async () => {
  const f = await setup(),
    doc = await f.doc()
  vi.spyOn(embeddingNet, "publicFetch").mockImplementation(
    async (_url, options) => {
      expect(options).toMatchObject({ timeoutMs: 10000, maxBytes: 64 * 1024 })
      return Response.json({ embedding: { values: Array(768).fill(1) } })
    }
  )
  await f.t.action(internal.knowledge.ingest.ingest, {
    id: doc._id,
    revision: doc.revision,
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("knowledgeDocuments", doc._id))
  ).toMatchObject({ status: "ready", byteSize: 25 })
  const chunks = await f.t.run((ctx) =>
    ctx.db
      .query("knowledgeChunks")
      .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
      .collect()
  )
  expect(chunks).toHaveLength(1)
  expect(chunks[0]).toMatchObject({
    scope: scope(f.organizationId, f.baseId),
    embedding: expect.any(Array),
  })
  await f.owner.client.action(api.knowledge.resources.dashboardWrite, {
    organizationId: f.organizationId,
    knowledgeBaseId: f.baseId,
    id: doc._id,
    body: JSON.stringify({ text: "Updated manual" }),
  })
  const updated = (await f.t.run((ctx) =>
    ctx.db.get("knowledgeDocuments", doc._id)
  ))!
  expect(updated.revision).not.toBe(doc.revision)
  await f.t.mutation(internal.knowledge.state.complete, {
    id: doc._id,
    revision: doc.revision,
    byteSize: 1,
    chunks: [],
    error: "Stale failure",
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("knowledgeDocuments", doc._id))
  ).toMatchObject({ status: "processing" })
  await f.t.action(internal.knowledge.ingest.ingest, {
    id: doc._id,
    revision: updated.revision,
  })
  expect(
    (
      await f.t.run((ctx) =>
        ctx.db
          .query("knowledgeChunks")
          .withIndex("by_documentId", (q) => q.eq("documentId", doc._id))
          .collect()
      )
    )[0].text
  ).toBe("Updated manual")
  vi.spyOn(embeddingNet, "publicFetch").mockResolvedValue(
    new Response("Never expose provider details", { status: 429 })
  )
  const failed = await f.doc()
  await f.t.action(internal.knowledge.ingest.ingest, {
    id: failed._id,
    revision: failed.revision,
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("knowledgeDocuments", failed._id))
  ).toMatchObject({
    status: "failed",
    error: expect.stringMatching(/HTTP 429/),
  })
})
test("vector search filters by combined organization and KB and rejects foreign hydration", async () => {
  const f = await setup(),
    first = await f.doc(),
    other = await f.owner.client.action(
      api.knowledge.resources.dashboardWrite,
      {
        organizationId: f.organizationId,
        body: JSON.stringify({ name: "Other" }),
      }
    )
  const rows = await f.t.run(async (ctx) => {
    const a = await ctx.db.insert("knowledgeChunks", {
      organizationId: f.organizationId,
      knowledgeBaseId: f.baseId,
      scope: scope(f.organizationId, f.baseId),
      documentId: first._id,
      revision: first.revision,
      text: "Allowed",
      position: 0,
      embedding: Array(768).fill(1),
    })
    const b = await ctx.db.insert("knowledgeChunks", {
      organizationId: f.organizationId,
      knowledgeBaseId: other.id as Id<"knowledgeBases">,
      scope: scope(f.organizationId, other.id),
      documentId: first._id,
      revision: first.revision,
      text: "Other base",
      position: 0,
      embedding: Array(768).fill(1),
    })
    const c = await ctx.db.insert("knowledgeChunks", {
      organizationId: f.outsider.team,
      knowledgeBaseId: f.baseId,
      scope: scope(f.outsider.team, f.baseId),
      documentId: first._id,
      revision: first.revision,
      text: "Other organization",
      position: 0,
      embedding: Array(768).fill(1),
    })
    await ctx.db.patch("knowledgeDocuments", first._id, { status: "ready" })
    return [a, b, c]
  })
  vi.spyOn(embeddingNet, "publicFetch").mockImplementation(
    async (_url, options) => {
      expect(options).toMatchObject({ timeoutMs: 10000, maxBytes: 64 * 1024 })
      return Response.json({ embedding: { values: Array(768).fill(1) } })
    }
  )
  const found = await f.owner.client.action(
    api.knowledge.search.dashboardSearch,
    {
      organizationId: f.organizationId,
      knowledgeBaseIds: [f.baseId],
      query: "Hours",
    }
  )
  expect(found.data.map((row: KnowledgeMatch) => row.id)).toEqual([rows[0]])
  const hydrated = await f.t.query(internal.knowledge.state.hydrate, {
    organizationId: f.organizationId,
    knowledgeBaseIds: [f.baseId],
    hits: rows.map((_id) => ({ _id, _score: 1 })),
  })
  expect(hydrated.map((row: KnowledgeMatch) => row.id)).toEqual([rows[0]])
  await expect(
    f.outsider.client.action(api.knowledge.search.dashboardSearch, {
      organizationId: f.organizationId,
      knowledgeBaseIds: [f.baseId],
      query: "Private",
    })
  ).rejects.toThrow(/permission/i)
})
test("collection resolves the caller, maps contact properties, preserves explicit values and requires transcript evidence", async () => {
  const f = await setup()
  await f.owner.client.mutation(api.contactProperties.create, {
    organizationId: f.organizationId,
    key: "participants",
    name: "Participants",
    type: "number",
  })
  const fields = [
    {
      key: "participants",
      label: "Participants",
      description: "Ask how many",
      type: "number" as const,
      required: true,
      contactProperty: "participants",
    },
    {
      key: "city",
      label: "City",
      description: "Ask where",
      type: "text" as const,
      required: false,
    },
  ]
  const callId = await f.t.run(async (ctx) => {
    const config = validateBot({
      name: "Generic",
      provider: "gemini",
      credentialId: f.credentialId,
      collect: fields,
    })
    const botId = await ctx.db.insert("voiceBots", {
      ...config,
      credentialId: f.credentialId,
      knowledgeBaseIds: undefined,
      customToolIds: undefined,
      stt: undefined,
      llm: undefined,
      tts: undefined,
      organizationId: f.organizationId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    return ctx.db.insert("calls", {
      organizationId: f.organizationId,
      accountId: f.account,
      direction: "inbound",
      status: "connected",
      mode: "gateway",
      from: "+919999999999",
      observedAt: Date.now(),
      botId,
      botConfig: {
        ...config,
        credentialId: f.credentialId,
        knowledgeBaseIds: undefined,
        customToolIds: undefined,
        stt: undefined,
        llm: undefined,
        tts: undefined,
      },
      botActive: true,
      botStartedAt: Date.now(),
    })
  })
  await f.t.run(async (ctx) =>
    saveCollectedField(
      ctx,
      (await ctx.db.get("calls", callId))!,
      "participants",
      0
    )
  )
  await expect(
    f.t.run(async (ctx) =>
      saveCollectedField(
        ctx,
        (await ctx.db.get("calls", callId))!,
        "participants",
        "wrong"
      )
    )
  ).rejects.toThrow(/number/)
  await expect(
    f.t.run(async (ctx) =>
      saveCollectedField(
        ctx,
        (await ctx.db.get("calls", callId))!,
        "unknown",
        "x"
      )
    )
  ).rejects.toThrow(/not configured/)
  const call = (await f.t.run((ctx) => ctx.db.get("calls", callId)))!
  expect(call.collected).toEqual({
    participants: { value: 0, inferred: false },
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("contacts", call.contactId!))
  ).toMatchObject({ properties: { participants: "0" } })
  await f.t.run(async (ctx) => {
    await ctx.db.insert("callTranscripts", {
      organizationId: f.organizationId,
      callId,
      eventId: "quote",
      kind: "transcript",
      role: "caller",
      text: "I live in Pune",
      final: true,
      timestampMs: 1,
    })
    await inferCollectedFields(ctx, (await ctx.db.get("calls", callId))!, {
      participants: { value: 5, confidence: 1, evidence: "Pune" },
      city: { value: "Pune", confidence: 0.5, evidence: "Pune" },
    })
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", callId)))!.collected?.city
  ).toBeUndefined()
  await f.t.run(async (ctx) =>
    inferCollectedFields(ctx, (await ctx.db.get("calls", callId))!, {
      city: { value: "Pune", confidence: 0.99, evidence: "I live in Pune" },
    })
  )
  await f.t.run(async (ctx) =>
    completeCollection(ctx, (await ctx.db.get("calls", callId))!)
  )
  await f.t.run(async (ctx) =>
    completeCollection(ctx, (await ctx.db.get("calls", callId))!)
  )
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.organizationId)
      )
      .collect()
  )
  expect(events.filter((e) => e.type === "call.data_collected")).toHaveLength(1)
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", callId)))!.collected
  ).toEqual({
    participants: { value: 0, inferred: false },
    city: { value: "Pune", inferred: true },
  })
})
test("REST resources enforce scopes, ownership, schema validation and write-only encrypted tool secrets", async () => {
  const f = await setup()
  const readKey = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.organizationId,
    input: {
      name: "Knowledge reader",
      permission: "custom",
      scopes: ["knowledge:read"],
      domainId: null,
    },
  })
  expect(
    (await f.request("/knowledge-bases", "GET", undefined, readKey.token))
      .status
  ).toBe(200)
  expect(
    (await f.request("/knowledge-bases", "POST", { name: "No" }, readKey.token))
      .status
  ).toBe(403)
  expect(
    (await f.request("/bot-tools", "GET", undefined, readKey.token)).status
  ).toBe(403)
  const input = {
    name: "book_appointment",
    description: "Book an appointment",
    url: "https://example.test/tool",
    headers: { authorization: "Bearer sk_fixture_not_a_real_key" },
    signingSecret: "fixture-shared-signing-secret-long-enough",
    parameters: {
      type: "object",
      properties: { guests: { type: "number" } },
      required: ["guests"],
    },
  }
  const create = await f.request("/bot-tools", "POST", input)
  expect(create.status).toBe(200)
  const { id } = await create.json()
  const stored = await f.t.run((ctx) => ctx.db.get("botTools", id))
  expect(JSON.stringify(stored)).not.toContain("sk_fixture_not_a_real_key")
  const shown = await (await f.request(`/bot-tools/${id}`)).json()
  expect(shown.headers).toBeUndefined()
  expect(shown.encryptedHeaders).toBeUndefined()
  expect(shown.signingSecret).toBeUndefined()
  expect(
    (await f.request(`/bot-tools/${id}`, "PATCH", { description: "Updated" }))
      .status
  ).toBe(200)
  expect(
    (await f.t.run((ctx) => ctx.db.get("botTools", id)))!.encryptedHeaders
  ).toBe(stored!.encryptedHeaders)
  expect(
    (
      await f.request("/bot-tools", "POST", {
        ...input,
        name: "lookup_contact",
      })
    ).status
  ).toBe(422)
  expect(
    (
      await f.request("/bot-tools", "POST", {
        ...input,
        url: "https://127.0.0.1/tool",
      })
    ).status
  ).toBe(422)
  expect(
    (
      await f.request("/bot-tools", "POST", {
        ...input,
        parameters: { type: "object", properties: { x: { type: "object" } } },
      })
    ).status
  ).toBe(422)
  await expect(
    f.outsider.client.action(api.botTools.resources.dashboardWrite, {
      organizationId: f.organizationId,
      id,
      body: "{}",
    })
  ).rejects.toThrow(/permission/i)
  const doc = await f.doc()
  expect(
    (await f.request(`/knowledge-bases/${f.baseId}/documents/${doc._id}`))
      .status
  ).toBe(200)
  expect(
    (
      await f.request(
        `/knowledge-bases/${f.baseId}/documents/${doc._id}`,
        "DELETE"
      )
    ).status
  ).toBe(200)
  await f.t.mutation(internal.knowledge.state.complete, {
    id: doc._id,
    revision: doc.revision,
    byteSize: 0,
    chunks: [],
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("knowledgeDocuments", doc._id))
  ).toBeNull()
})
test("gateway declares attached tools, validates scalar save_field and durably deduplicates signed webhook execution", async () => {
  const f = await setup()
  const net = await import("../lib/net/public-fetch")
  const outbound = vi.spyOn(net, "publicFetch").mockResolvedValue(
    Response.json({
      visible: "saved",
      internal: "hidden",
      authorization: "sk_fixture_not_a_real_key",
    })
  )
  const tool = await f.owner.client.action(
    api.botTools.resources.dashboardWrite,
    {
      organizationId: f.organizationId,
      body: JSON.stringify({
        name: "book_appointment",
        description: "Book appointment",
        url: "https://example.test/tool",
        headers: { authorization: "Bearer sk_fixture_not_a_real_key" },
        signingSecret: "fixture-shared-signing-secret-long-enough",
        parameters: {
          type: "object",
          properties: { guests: { type: "number" } },
          required: ["guests"],
        },
        resultFields: ["visible"],
      }),
    }
  )
  const bot = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.organizationId,
    kind: "bot",
    body: JSON.stringify({
      name: "Generic",
      provider: "gemini",
      credentialId: f.credentialId,
      knowledgeBaseIds: [f.baseId],
      customToolIds: [tool.id],
      collect: [
        {
          key: "guests",
          label: "Guests",
          description: "Ask how many",
          type: "number",
          required: true,
        },
      ],
    }),
  })
  const callId = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("voiceBots", bot.id as Id<"voiceBots">))!
    const {
      _id,
      _creationTime,
      organizationId,
      createdAt,
      updatedAt,
      ...config
    } = row
    void _creationTime
    void createdAt
    void updatedAt
    return ctx.db.insert("calls", {
      organizationId,
      accountId: f.account,
      botId: _id,
      botConfig: config,
      botActive: true,
      botStartedAt: Date.now(),
      observedAt: Date.now(),
      direction: "inbound",
      status: "connected",
      mode: "gateway",
      from: "+919999999999",
    })
  })
  const { signRequest } = await import("../services/call-gateway/src/auth")
  const secret = "fixture-gateway-shared-secret-".repeat(3)
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  const signed = (path: string, toolCall?: unknown) => {
    const body = JSON.stringify({
      version: 1,
      callId,
      organizationId: f.organizationId,
      ...(toolCall ? { toolCall } : {}),
    })
    return f.t.fetch(`/calling/gateway/voice/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest(secret, "POST", `/calling/gateway/voice/${path}`, body),
      },
      body,
    })
  }
  const session = await (await signed("session")).json()
  expect(session.toolCatalog.map((t: { name: string }) => t.name)).toEqual([
    "search_knowledge",
    "save_field",
    "book_appointment",
  ])
  expect(JSON.stringify(session.toolCatalog)).not.toContain(
    "sk_fixture_not_a_real_key"
  )
  const saved = await (
    await signed("tools", {
      id: "save-1",
      name: "save_field",
      arguments: { key: "guests", value: 0 },
    })
  ).json()
  expect(saved).toMatchObject({
    ok: true,
    result: { value: 0, inferred: false },
  })
  expect(
    await (
      await signed("tools", {
        id: "save-2",
        name: "save_field",
        arguments: { key: "guests", value: "wrong" },
      })
    ).json()
  ).toMatchObject({ ok: false })
  const request = {
    id: "custom-1",
    name: "book_appointment",
    arguments: { guests: 0 },
  }
  const result = await (await signed("tools", request)).json()
  expect(result).toEqual({ ok: true, result: { visible: "saved" } })
  expect(await (await signed("tools", request)).json()).toEqual(result)
  expect(outbound).toHaveBeenCalledTimes(1)
  expect(
    await (
      await signed("tools", { ...request, arguments: { guests: 1 } })
    ).json()
  ).toMatchObject({ ok: false })
  expect(
    await (
      await signed("tools", { id: "other", name: "unattached", arguments: {} })
    ).json()
  ).toMatchObject({ ok: false })
  const logs = await f.t.run((ctx) =>
    ctx.db
      .query("callTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .collect()
  )
  expect(JSON.stringify(logs)).not.toContain("sk_fixture_not_a_real_key")
  expect(
    logs.some((l) => l.kind === "media" && l.text?.includes("latencyMs"))
  ).toBe(true)
  await f.t.run((ctx) => ctx.db.patch("calls", callId, { botActive: false }))
  expect((await signed("tools", { ...request, id: "ended" })).status).toBe(404)
  await f.owner.client.action(api.botTools.resources.dashboardWrite, {
    organizationId: f.organizationId,
    id: tool.id,
    remove: true,
    body: "{}",
  })
  await f.owner.client.action(api.knowledge.resources.dashboardWrite, {
    organizationId: f.organizationId,
    id: f.baseId,
    remove: true,
    body: "{}",
  })
  await f.t.mutation(internal.botToolkitAccess.detach, {
    organizationId: f.organizationId,
    kind: "tool",
    id: tool.id,
    paginationOpts: { numItems: 20, cursor: null },
  })
  await f.t.mutation(internal.botToolkitAccess.detach, {
    organizationId: f.organizationId,
    kind: "knowledge",
    id: f.baseId,
    paginationOpts: { numItems: 20, cursor: null },
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("voiceBots", bot.id as Id<"voiceBots">))
  ).toMatchObject({ customToolIds: [], knowledgeBaseIds: [] })
})

test("knowledge tool timestamps include time before the bot joined the call", async () => {
  const f = await setup()
  const now = Date.now()
  const bot = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.organizationId,
    kind: "bot",
    body: JSON.stringify({
      name: "Transferred bot",
      provider: "gemini",
      credentialId: f.credentialId,
      knowledgeBaseIds: [f.baseId],
    }),
  })
  const callId = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("voiceBots", bot.id as Id<"voiceBots">))!
    const {
      _id,
      _creationTime,
      organizationId,
      createdAt,
      updatedAt,
      ...config
    } = row
    void [_creationTime, createdAt, updatedAt]
    return ctx.db.insert("calls", {
      organizationId,
      accountId: f.account,
      botId: _id,
      botConfig: config,
      botActive: true,
      connectedAt: now - 20000,
      botStartedAt: now - 10000,
      observedAt: now,
      direction: "inbound",
      status: "connected",
      mode: "gateway",
    })
  })
  const prepared = await f.t.mutation(internal.voice.toolkitState.begin, {
    nonce: crypto.randomUUID(),
    expiresAt: now + 30000,
    data: {
      callId,
      organizationId: f.organizationId,
      toolCall: {
        id: "search-1",
        name: "search_knowledge",
        arguments: { query: "Hours" },
      },
    },
  })
  await f.t.mutation(internal.voice.toolkitState.finish, {
    logId: prepared.logId!,
    result: JSON.stringify({ ok: true, result: { data: [] } }),
    latencyMs: 250,
  })
  const transcript = await f.owner.client.query(
    internal.voice.resources.transcript,
    {
      organizationId: f.organizationId,
      id: callId,
      limit: 100,
    }
  )
  expect(transcript.data).toEqual([
    expect.objectContaining({
      kind: "media",
      timeline: "call",
      timestampMs: 20250,
    }),
    expect.objectContaining({
      kind: "tool",
      timeline: "call",
      timestampMs: 20000,
    }),
  ])
})
test("toolkit REST request and response bodies validate against the published OpenAPI contract", async () => {
  const f = await setup()
  const contract = (await SwaggerParser.dereference(
    resolve("openapi/opensend.yaml")
  )) as unknown as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: { content: { "application/json": { schema: object } } }
          responses: Record<
            string,
            { content: { "application/json": { schema: object } } }
          >
        }
      >
    >
  }
  const ajv = new Ajv2020({ strict: false, validateFormats: false })
  const check = async (
    path: string,
    actual: string,
    method = "GET",
    body?: unknown
  ) => {
    const operation = contract.paths[path][method.toLowerCase()]
    if (body && operation.requestBody)
      expect(
        ajv.validate(
          operation.requestBody.content["application/json"].schema,
          body
        ),
        JSON.stringify(ajv.errors)
      ).toBe(true)
    const response = await f.request(actual, method, body)
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(
      ajv.validate(
        operation.responses["200"].content["application/json"].schema,
        result
      ),
      JSON.stringify(ajv.errors)
    ).toBe(true)
    return result
  }
  await check("/knowledge-bases", "/knowledge-bases")
  const base = await check("/knowledge-bases", "/knowledge-bases", "POST", {
    name: "Reference",
  })
  await check("/knowledge-bases/{id}", `/knowledge-bases/${base.id}`)
  await check("/knowledge-bases/{id}", `/knowledge-bases/${base.id}`, "PATCH", {
    description: "Edited",
  })
  const doc = await check(
    "/knowledge-bases/{knowledgeBaseId}/documents",
    `/knowledge-bases/${base.id}/documents`,
    "POST",
    { title: "Notes", source: "text", text: "Reference facts" }
  )
  await check(
    "/knowledge-bases/{knowledgeBaseId}/documents",
    `/knowledge-bases/${base.id}/documents`
  )
  await check(
    "/knowledge-bases/{knowledgeBaseId}/documents/{id}",
    `/knowledge-bases/${base.id}/documents/${doc.id}`
  )
  await check(
    "/knowledge-bases/{knowledgeBaseId}/documents/{id}",
    `/knowledge-bases/${base.id}/documents/${doc.id}`,
    "PATCH",
    { text: "Updated reference" }
  )
  vi.spyOn(embeddingNet, "publicFetch").mockImplementation(
    async (_url, options) => {
      expect(options).toMatchObject({ timeoutMs: 10000, maxBytes: 64 * 1024 })
      return Response.json({ embedding: { values: Array(768).fill(1) } })
    }
  )
  await check(
    "/knowledge-bases/{id}/search",
    `/knowledge-bases/${base.id}/search`,
    "POST",
    { query: "Question", limit: 3 }
  )
  const tool = await check("/bot-tools", "/bot-tools", "POST", {
    name: "fetch_status",
    description: "Read status",
    url: "https://example.test/tool",
    parameters: { type: "object", properties: {} },
  })
  await check("/bot-tools", "/bot-tools")
  await check("/bot-tools/{id}", `/bot-tools/${tool.id}`)
  await check("/bot-tools/{id}", `/bot-tools/${tool.id}`, "PATCH", {
    timeoutMs: 2000,
  })
  const net = await import("../lib/net/public-fetch")
  vi.spyOn(net, "publicFetch").mockResolvedValue(
    Response.json({ status: "Ready" })
  )
  await check("/bot-tools/{id}/test", `/bot-tools/${tool.id}/test`, "POST", {})
  await check("/bot-tools/{id}", `/bot-tools/${tool.id}`, "DELETE")
  await check(
    "/knowledge-bases/{knowledgeBaseId}/documents/{id}",
    `/knowledge-bases/${base.id}/documents/${doc.id}`,
    "DELETE"
  )
  await check("/knowledge-bases/{id}", `/knowledge-bases/${base.id}`, "DELETE")
})

test("deleted attachment cleanup follows native pagination across teams and pages", async () => {
  const f = await setup()
  const bot = await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.organizationId,
    kind: "bot",
    body: JSON.stringify({
      name: "Reusable",
      provider: "gemini",
      credentialId: f.credentialId,
      knowledgeBaseIds: [f.baseId],
    }),
  })
  const foreignId = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("voiceBots", bot.id as Id<"voiceBots">))!
    const { _id, _creationTime, ...config } = row
    void _id
    void _creationTime
    for (let i = 0; i < 21; i++) await ctx.db.insert("voiceBots", config)
    return ctx.db.insert("voiceBots", {
      ...config,
      organizationId: f.outsider.team,
    })
  })
  await f.owner.client.action(api.knowledge.resources.dashboardWrite, {
    organizationId: f.organizationId,
    id: f.baseId,
    remove: true,
    body: "{}",
  })
  await f.t.finishAllScheduledFunctions(() => vi.runAllTimersAsync())
  const bots = await f.t.run((ctx) =>
    ctx.db
      .query("voiceBots")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.organizationId)
      )
      .collect()
  )
  expect(bots).toHaveLength(22)
  expect(bots.every((bot) => bot.knowledgeBaseIds?.length === 0)).toBe(true)
  expect(
    (await f.t.run((ctx) => ctx.db.get("voiceBots", foreignId)))!
      .knowledgeBaseIds
  ).toEqual([f.baseId])
})

test("a deleted knowledge base or voice bot reads as not found in the dashboard but stays a 404 in the API", async () => {
  const f = await setup()
  const read = () =>
    f.owner.client.query(api.knowledge.resources.dashboardGet, {
      organizationId: f.organizationId,
      id: f.baseId,
    })
  expect(await read()).toMatchObject({ id: f.baseId })
  await f.owner.client.action(api.knowledge.resources.dashboardWrite, {
    organizationId: f.organizationId,
    id: f.baseId,
    remove: true,
    body: "{}",
  })
  expect(await read()).toBeNull()
  expect(
    await f.owner.client.query(api.knowledge.resources.dashboardList, {
      organizationId: f.organizationId,
      knowledgeBaseId: f.baseId,
      limit: 100,
    })
  ).toEqual({ has_more: false, data: [] })
  expect((await f.request(`/knowledge-bases/${f.baseId}`)).status).toBe(404)
  // Another team's id is just as missing; other errors still throw.
  await expect(
    f.outsider.client.query(api.knowledge.resources.dashboardGet, {
      organizationId: f.organizationId,
      id: f.baseId,
    })
  ).rejects.toThrow()

  const { id: bot } = await f.owner.client.action(
    api.voice.resources.dashboardWrite,
    {
      organizationId: f.organizationId,
      kind: "bot",
      body: JSON.stringify({
        name: "Deleted bot",
        provider: "gemini",
        credentialId: f.credentialId,
      }),
    }
  )
  const readBot = () =>
    f.owner.client.query(api.voice.resources.dashboardGet, {
      organizationId: f.organizationId,
      id: bot,
    })
  expect(await readBot()).toMatchObject({ id: bot })
  await f.owner.client.action(api.voice.resources.dashboardWrite, {
    organizationId: f.organizationId,
    kind: "removeBot",
    id: bot,
    body: "{}",
  })
  expect(await readBot()).toBeNull()
})
