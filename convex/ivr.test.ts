// @vitest-environment node
import { afterEach, beforeEach, test, expect, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture } from "./testHelpers/meta.fixture"
import { signRequest } from "../services/call-gateway/src/auth"
import * as net from "../lib/net/public-fetch"
import { minuteUsage } from "./voice/usage"
import { webhookHeaders } from "../lib/webhooks/signing"
const secret = "a".repeat(64),
  hangup = { kind: "hangup" }
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function setup() {
  const f = await inboundFixture()
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "IVR", permission: "full_access", domainId: null },
  })
  const upload = await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["RIFF audio"], { type: "audio/wav" })
    )
    return ctx.db.insert("storedFiles", {
      organizationId: f.owner.team,
      provider: "convex",
      storageId,
      size: 10,
      contentType: "audio/wav",
      state: "ready",
      feature: "ivr",
    })
  })
  const definition = {
    name: "Reception",
    language: "en",
    entryMenuId: "main",
    menus: [
      {
        id: "main",
        name: "Main",
        prompt: { kind: "audio", fileId: upload },
        options: { "1": { kind: "submenu", menuId: "support" } },
        noInputAction: hangup,
        failureAction: hangup,
      },
      {
        id: "support",
        name: "Support",
        prompt: { kind: "audio", fileId: upload },
        options: { "2": { kind: "voicemail" } },
        noInputAction: hangup,
        failureAction: hangup,
      },
    ],
  }
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    idempotency?: string
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
        ...(idempotency ? { "idempotency-key": idempotency } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const created = await request("/ivrs", "POST", definition, "create-once")
  expect(created.status).toBe(201)
  const ivr = await created.json()
  const callId = await f.t.run(async (ctx) => {
    await ctx.db.insert("callingSettings", {
      organizationId: f.owner.team,
      accountId: f.account,
      mode: "gateway",
      settings: "{}",
      updatedAt: Date.now(),
      routing: { kind: "ivr", ivrId: ivr.id },
    })
    return ctx.db.insert("calls", {
      organizationId: f.owner.team,
      accountId: f.account,
      direction: "inbound",
      mode: "gateway",
      status: "connected",
      observedAt: Date.now(),
    })
  })
  const signed = async (path: string, data: object) => {
    const body = JSON.stringify(data)
    return f.t.fetch(path, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...signRequest(secret, "POST", path, body),
      },
    })
  }
  const start = () =>
    signed("/calling/gateway/ivr/start", { callId, ivrId: ivr.id })
  const next = (menuId: string, digits: string, step: number) =>
    signed("/calling/gateway/ivr/next", {
      callId,
      ivrId: ivr.id,
      menuId,
      digits,
      step,
    })
  return {
    ...f,
    key,
    upload,
    definition,
    request,
    ivr,
    callId,
    signed,
    start,
    next,
  }
}
test("IVR REST CRUD, idempotency, dry-run validation and tenant isolation", async () => {
  const f = await setup()
  expect(
    (await f.request("/ivrs", "POST", f.definition, "create-once")).status
  ).toBe(201)
  expect((await (await f.request("/ivrs")).json()).data).toHaveLength(1)
  expect(
    (
      await (
        await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { name: "Updated" })
      ).json()
    ).name
  ).toBe("Updated")
  const invalid = await (
    await f.request(`/ivrs/${f.ivr.id}/validate`, "POST", {
      entryMenuId: "missing",
    })
  ).json()
  expect(invalid.valid).toBe(false)
  expect(
    (await f.owner.client.query(api.ivr.definitions.dashboardGet, {
      organizationId: f.owner.team,
      id: f.ivr.id,
    }))!.name
  ).toBe("Updated")
  expect(
    await f.outsider.client.query(api.ivr.definitions.dashboardGet, {
      organizationId: f.outsider.team,
      id: f.ivr.id,
    })
  ).toBeNull()
  await expect(
    f.owner.client.action(api.ivr.definitions.dashboardWrite, {
      organizationId: f.owner.team,
      kind: "create",
      body: JSON.stringify({
        ...f.definition,
        menus: [
          {
            ...f.definition.menus[0],
            options: {},
            prompt: { kind: "audio", fileId: "not-a-file" },
          },
        ],
      }),
    })
  ).rejects.toBeTruthy()
  expect((await f.request(`/ivrs/${f.ivr.id}`, "DELETE")).status).toBe(422)
  await f.t.run(async (ctx) => {
    const settings = await ctx.db
      .query("callingSettings")
      .withIndex("by_accountId", (q) => q.eq("accountId", f.account))
      .unique()
    await ctx.db.patch("callingSettings", settings!._id, {
      routing: { kind: "agents" },
    })
  })
  expect((await f.request(`/ivrs/${f.ivr.id}`, "DELETE")).status).toBe(200)
  expect((await f.request(`/ivrs/${f.ivr.id}`)).status).toBe(404)
})
test("a deleted IVR reads as null in the dashboard but stays a 404 in the API", async () => {
  const f = await setup()
  const read = () =>
    f.owner.client.query(api.ivr.definitions.dashboardGet, {
      organizationId: f.owner.team,
      id: f.ivr.id,
    })
  expect(await read()).toMatchObject({ id: f.ivr.id })
  await f.t.run(async (ctx) => {
    const settings = await ctx.db
      .query("callingSettings")
      .withIndex("by_accountId", (q) => q.eq("accountId", f.account))
      .unique()
    await ctx.db.patch("callingSettings", settings!._id, {
      routing: { kind: "agents" },
    })
  })
  await f.owner.client.action(api.ivr.definitions.dashboardWrite, {
    organizationId: f.owner.team,
    kind: "remove",
    id: f.ivr.id,
    body: "{}",
  })
  expect(await read()).toBeNull()
  expect((await f.request(`/ivrs/${f.ivr.id}`)).status).toBe(404)
  // Missing records do not suppress authorization errors.
  await expect(
    f.outsider.client.query(api.ivr.definitions.dashboardGet, {
      organizationId: f.owner.team,
      id: f.ivr.id,
    })
  ).rejects.toThrow()
})

test("signed start/next records submenu → voicemail, authenticates audio and rejects stale/replayed decisions", async () => {
  const f = await setup(),
    start = await f.start()
  expect(start.status).toBe(200)
  const d = await start.json()
  expect(d.menu).toMatchObject({
    id: "main",
    timeoutSeconds: 5,
    retries: 2,
    maxDigits: 1,
  })
  const audio = await f.t.fetch(
    new URL(d.menu.promptUrl).pathname + new URL(d.menu.promptUrl).search
  )
  expect(audio.status).toBe(200)
  const forged = new URL(d.menu.promptUrl)
  forged.searchParams.set("fileId", "other")
  expect((await f.t.fetch(forged.pathname + forged.search)).status).toBe(401)
  expect((await (await f.next("main", "1", 0)).json()).action).toEqual({
    kind: "submenu",
    menuId: "support",
  })
  expect((await f.next("main", "1", 0)).status).toBe(409)
  expect((await (await f.next("support", "2", 1)).json()).action).toEqual({
    kind: "voicemail",
  })
  const row = await f.t.run((ctx) => ctx.db.get("calls", f.callId))
  expect(row!.ivrPath!.map((e) => [e.menuId, e.digits, e.action.kind])).toEqual(
    [
      ["main", "1", "submenu"],
      ["support", "2", "voicemail"],
    ]
  )
  expect(row!.ivrOutcome).toEqual({ kind: "voicemail" })
  const event = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .order("desc")
      .first()
  )
  expect(event!.type).toBe("whatsapp.call.ivr_completed")
  expect((await f.next("support", "2", 1)).status).toBe(409)
  const body = JSON.stringify({ callId: f.callId, ivrId: f.ivr.id }),
    headers = signRequest(secret, "POST", "/calling/gateway/ivr/start", body)
  await f.t.fetch("/calling/gateway/ivr/start", {
    method: "POST",
    body,
    headers,
  })
  expect(
    (
      await f.t.fetch("/calling/gateway/ivr/start", {
        method: "POST",
        body,
        headers,
      })
    ).status
  ).toBe(409)
  expect(
    (
      await f.t.fetch("/calling/gateway/ivr/next", {
        method: "POST",
        body: "{}",
      })
    ).status
  ).toBe(401)
})
test.each([
  "hangup",
  "voicemail",
  "bot",
  "playAndHangup",
  "agents",
  "timeout",
  "invalid",
])("IVR next decision %s", async (kind) => {
  const f = await setup()
  if (kind === "agents")
    await f.t.run((ctx) =>
      ctx.db.insert("callAgents", {
        organizationId: f.owner.team,
        userId: f.owner.user._id,
        name: "Agent",
        authSessionId: f.owner.session._id,
        browserId: "browser",
        leaseId: "lease",
        status: "online",
        extension: "2001",
        expiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      })
    )
  let botId
  if (kind === "bot") {
    const credential = await (
      await f.request("/voice-providers", "POST", {
        provider: "gemini",
        label: "IVR bot",
        key: "fixture-key",
      })
    ).json()
    const bot = await (
      await f.request("/voice-bots", "POST", {
        name: "IVR bot",
        provider: "gemini",
        credentialId: credential.id,
      })
    ).json()
    botId = bot.id
  }
  const chosen =
    kind === "bot"
      ? { kind, botId }
      : kind === "playAndHangup"
        ? { kind, prompt: { kind: "audio", fileId: f.upload } }
        : kind === "timeout" || kind === "invalid"
          ? { kind: "voicemail" }
          : { kind }
  const menu = {
    ...f.definition.menus[0],
    options: { "1": chosen },
    noInputAction: chosen,
    failureAction: chosen,
  }
  expect(
    (await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus: [menu] })).status
  ).toBe(200)
  await f.start()
  const result = await f.next(
    "main",
    kind === "timeout" || kind === "invalid" ? kind : "1",
    0
  )
  expect(result.status).toBe(200)
  const reply = await result.json()
  expect(reply.action.kind).toBe(chosen.kind)
  if (kind === "agents") expect(reply.extension).toBe("2001")
  if (kind === "playAndHangup")
    expect(reply.promptUrl).toContain("/calling/ivr/audio/")
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", f.callId)))!.ivrPath
  ).toHaveLength(1)
})
test("business-hours closed action and pending TTS are safe, cached and do not collect digits", async () => {
  const f = await setup()
  const tts = { kind: "tts", text: "Hello", voice: "default" }
  const menus = [
    {
      ...f.definition.menus[0],
      options: {},
      prompt: tts,
      failureAction: { kind: "voicemail" },
    },
  ]
  await f.request(`/ivrs/${f.ivr.id}`, "PATCH", {
    menus,
    businessHours: {
      status: "ENABLED",
      timezone_id: "Asia/Kolkata",
      weekly_operating_hours: [],
      closedAction: { kind: "voicemail" },
    },
  })
  await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus })
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("ivrPromptRenders")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(10)
    )
  ).toHaveLength(1)
  expect((await (await f.start()).json()).action).toEqual({ kind: "voicemail" })
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", f.callId)))!.ivrPath![0]
  ).toMatchObject({ menuId: "business_hours", digits: "closed" })
})
test.each([
  "success",
  "test success",
  "timeout",
  "bad schema",
  "foreign submenu",
])("webhook action signed POST and %s fallback", async (mode) => {
  const f = await setup()
  const webhook = { kind: "webhook", url: "https://customer.example/ivr" }
  const menu = {
    ...f.definition.menus[0],
    options: { "1": webhook },
    failureAction: { kind: "voicemail" },
  }
  expect(
    (await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus: [menu] })).status
  ).toBe(200)
  await f.start()
  if (mode === "test success")
    await f.t.run((ctx) => ctx.db.patch("calls", f.callId, { test: true }))
  const spy = vi
    .spyOn(net, "publicFetch")
    .mockImplementation(async (_url, opts) => {
      expect(opts?.timeoutMs).toBe(3000)
      expect(opts?.maxBytes).toBe(8192)
      const headers = opts!.headers!,
        body = opts!.body as string
      expect(headers["svix-signature"]).toBe(
        (
          await webhookHeaders({
            id: headers["svix-id"],
            timestamp: Number(headers["svix-timestamp"]),
            body,
            secret: f.ivr.webhook_signing_secret,
          })
        )["svix-signature"]
      )
      expect(JSON.parse(body).call.test === true).toBe(mode === "test success")
      expect(JSON.parse(body)).toMatchObject({
        call: { id: f.callId },
        menuId: "main",
        digits: "1",
      })
      if (mode === "timeout")
        throw new DOMException("Timed out", "TimeoutError")
      return Response.json(
        mode === "bad schema"
          ? { action: { kind: "execute", command: "bad" } }
          : mode === "foreign submenu"
            ? { action: { kind: "submenu", menuId: "foreign" } }
            : { action: { kind: "hangup" } }
      )
    })
  const result = await f.next("main", "1", 0)
  expect(result.status).toBe(200)
  expect((await result.json()).action).toEqual({
    kind: mode.endsWith("success") ? "hangup" : "voicemail",
  })
  expect(spy).toHaveBeenCalledOnce()
})

test("remote termination completes an unfinished IVR once and forbids late decisions", async () => {
  const f = await setup()
  await f.start()
  await f.t.mutation(internal.calling.rows.finish, {
    id: f.callId,
    status: "completed",
  })
  await f.t.mutation(internal.calling.rows.finish, {
    id: f.callId,
    status: "completed",
  })
  expect((await f.next("main", "1", 0)).status).toBe(404)
  const row = await f.t.run((ctx) => ctx.db.get("calls", f.callId))
  expect(row!.ivrOutcome).toEqual({ kind: "hangup" })
  expect(row!.ivrPath).toHaveLength(1)
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("events")
        .withIndex("by_organizationId", (q) =>
          q.eq("organizationId", f.owner.team)
        )
        .take(100)
    )
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "whatsapp.call.ivr_completed" }),
    ])
  )
})
test("IVR scopes and uploaded audio reject other teams and unsupported files", async () => {
  const f = await setup()
  const restricted = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "IVR read",
      permission: "custom",
      domainId: null,
      scopes: ["ivrs:read"],
    },
  })
  const headers = {
    authorization: `Bearer ${restricted.token}`,
    "content-type": "application/json",
  }
  expect((await f.t.fetch("/ivrs", { headers })).status).toBe(200)
  vi.setSystemTime(Date.now() + 1100)
  expect(
    (
      await f.t.fetch("/ivrs", {
        method: "POST",
        headers,
        body: JSON.stringify(f.definition),
      })
    ).status
  ).toBe(403)
  const other = await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["x"], { type: "audio/wav" })
    )
    return ctx.db.insert("storedFiles", {
      organizationId: f.outsider.team,
      provider: "convex",
      storageId,
      size: 1,
      contentType: "audio/wav",
      state: "ready",
      feature: "ivr",
    })
  })
  expect(
    (
      await f.request("/ivrs", "POST", {
        ...f.definition,
        menus: [
          {
            ...f.definition.menus[0],
            options: {},
            prompt: { kind: "audio", fileId: other },
          },
        ],
      })
    ).status
  ).toBe(422)
  await f.t.run((ctx) =>
    ctx.db.patch("storedFiles", f.upload, { contentType: "text/plain" })
  )
  expect(
    (await f.request(`/ivrs/${f.ivr.id}/validate`, "POST", {})).status
  ).toBe(200)
  expect(
    (await (await f.request(`/ivrs/${f.ivr.id}/validate`, "POST", {})).json())
      .valid
  ).toBe(false)
})

test("configured gateway UIC routes into its IVR only after Graph accepts", async () => {
  const f = await setup()
  const { CALLING_TEST_SDP: sdp } = await import("../lib/meta/calling-fixtures")
  const { fakeGraph, PHONE_ID } = await import("./testHelpers/meta.fixture")
  const order: string[] = []
  fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/calls`,
      respond: (call) => {
        const action = (call.body as { action: string }).action
        order.push(action)
        return { success: true }
      },
    },
  ])
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)),
        body = JSON.parse(init!.body as string)
      order.push(url.pathname)
      if (url.pathname === "/inbound") return Response.json({ answerSdp: sdp })
      if (url.pathname === "/route") {
        expect(body).toMatchObject({
          callId: f.callId,
          target: "ivr",
          ivrId: f.ivr.id,
        })
        expect(order.indexOf("accept")).toBeLessThan(order.indexOf("/route"))
        return Response.json({ ok: true })
      }
      throw new Error("Unexpected gateway request")
    }
  )
  vi.stubGlobal("fetch", fetcher)
  await f.t.run((ctx) =>
    ctx.db.patch("calls", f.callId, {
      status: "ringing",
      wacid: "wacid.ivr",
      remoteSession: { sdp_type: "offer", sdp },
    })
  )
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: f.callId,
  })
  expect(order).toEqual(["/inbound", "pre_accept", "accept", "/route"])
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", f.callId)))!
  ).toMatchObject({ status: "connected", gatewayRouted: true })
})
test("an open menu with pending TTS takes its failure action without exposing an audio URL", async () => {
  const f = await setup()
  expect(
    (
      await f.request(`/ivrs/${f.ivr.id}`, "PATCH", {
        menus: [
          {
            ...f.definition.menus[0],
            options: {},
            prompt: { kind: "tts", text: "Hello" },
            failureAction: { kind: "voicemail" },
          },
        ],
      })
    ).status
  ).toBe(200)
  const result = await (await f.start()).json()
  expect(result.action).toEqual({ kind: "voicemail" })
  expect(result.menu).toBeUndefined()
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", f.callId)))!.ivrOutcome
  ).toEqual({ kind: "voicemail" })
})

test("IVR → bot → configured IVR keeps one call, enforces tenant ownership and authorizes one re-entry", async () => {
  const f = await setup()
  const credential = await (
    await f.request("/voice-providers", "POST", {
      provider: "gemini",
      label: "IVR bot",
      key: "fixture-key",
    })
  ).json()
  const bot = await (
    await f.request("/voice-bots", "POST", {
      name: "Reception bot",
      provider: "gemini",
      credentialId: credential.id,
      tools: ["transfer_to_ivr"],
      handoff: { agents: true, ivrId: f.ivr.id },
    })
  ).json()
  const menu = {
    ...f.definition.menus[0],
    options: { "1": { kind: "bot", botId: bot.id } },
  }
  expect(
    (await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus: [menu] })).status
  ).toBe(200)
  expect(
    await f.t.mutation(internal.voice.routing.select, { id: f.callId })
  ).toMatchObject({ target: "ivr", ivrId: f.ivr.id })
  await f.start()
  const decision = await (await f.next("main", "1", 0)).json()
  expect(decision).toMatchObject({
    action: { kind: "bot", botId: bot.id },
    route: { target: "bot", botId: bot.id, organizationId: f.owner.team },
  })
  const call = await f.t.run((ctx) => ctx.db.get("calls", f.callId))
  expect(call).toMatchObject({
    botActive: true,
    botId: bot.id,
    ivrOutcome: { kind: "bot", botId: bot.id },
  })
  const tool = await f.signed("/calling/gateway/voice/tools", {
    version: 1,
    callId: f.callId,
    organizationId: f.owner.team,
    toolCall: { id: "handoff", name: "transfer_to_ivr", arguments: {} },
  })
  expect(await tool.json()).toMatchObject({
    ok: true,
    result: { action: "transfer_to_ivr", ivrId: f.ivr.id },
  })
  vi.setSystemTime(Date.now() + 2000)
  // Completion must reach Convex before the gateway starts the IVR.
  expect((await f.start()).status).toBe(409)
  expect(
    (
      await f.signed("/calling/gateway/voice/events", {
        version: 1,
        callId: f.callId,
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "bot_completed",
        outcome: "transferred_ivr",
        summary: "Returning to menu",
        usage: { inputTokens: 4 },
      })
    ).status
  ).toBe(200)
  expect((await f.start()).status).toBe(200)
  expect((await f.start()).status).toBe(409)
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    status: "connected",
    botActive: false,
    botOutcome: "transferred_ivr",
  })
  // A later bot visit retains measured minutes and ignores the old session's expiry.
  expect(await (await f.next("main", "1", 0)).json()).toMatchObject({
    action: { kind: "bot", botId: bot.id },
  })
  await f.t.mutation(internal.voice.routing.expire, {
    id: f.callId,
    startedAt: call!.botSessionStartedAt,
  })
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    botActive: true,
    botDuration: 2,
    botUsage: { inputTokens: 4 },
  })
  expect(
    await f.t.run((ctx) => minuteUsage.sum(ctx, { namespace: f.owner.team }))
  ).toBe(602)
  vi.setSystemTime(Date.now() + 3000)
  expect(
    (
      await f.signed("/calling/gateway/voice/events", {
        version: 1,
        callId: f.callId,
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "usage",
        usage: { inputTokens: 2 },
      })
    ).status
  ).toBe(200)
  expect(
    (
      await f.signed("/calling/gateway/voice/events", {
        version: 1,
        callId: f.callId,
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "bot_completed",
        outcome: "completed",
        summary: "Resolved",
        usage: { inputTokens: 3 },
      })
    ).status
  ).toBe(200)
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    botDuration: 5,
    botUsage: { inputTokens: 7 },
  })
  expect(
    await f.t.run((ctx) => minuteUsage.sum(ctx, { namespace: f.owner.team }))
  ).toBe(5)
  await f.t.run((ctx) =>
    ctx.db.patch("voiceBots", bot.id, { organizationId: f.outsider.team })
  )
  expect(
    (await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus: [menu] })).status
  ).toBe(404)
  expect(
    (await f.request(`/ivrs/${f.ivr.id}/validate`, "POST", { menus: [menu] }))
      .status
  ).toBe(200)
  expect(
    (
      await (
        await f.request(`/ivrs/${f.ivr.id}/validate`, "POST", { menus: [menu] })
      ).json()
    ).valid
  ).toBe(false)
})

test("IVR bot admission falls back when budget is exhausted", async () => {
  const f = await setup()
  const credential = await (
    await f.request("/voice-providers", "POST", {
      provider: "gemini",
      label: "Bot",
      key: "fixture-key",
    })
  ).json()
  const bot = await (
    await f.request("/voice-bots", "POST", {
      name: "Bot",
      provider: "gemini",
      credentialId: credential.id,
      monthlyMinuteBudget: 0,
    })
  ).json()
  const menu = {
    ...f.definition.menus[0],
    options: { "1": { kind: "bot", botId: bot.id } },
  }
  expect(
    (await f.request(`/ivrs/${f.ivr.id}`, "PATCH", { menus: [menu] })).status
  ).toBe(200)
  await f.start()
  expect(await (await f.next("main", "1", 0)).json()).toMatchObject({
    action: { kind: "voicemail" },
    route: { target: "voicemail" },
  })
  expect(await f.t.run((ctx) => ctx.db.get("calls", f.callId))).toMatchObject({
    botFallbackReason: "budget_exhausted",
    botOutcome: "budget_exhausted",
    ivrOutcome: { kind: "voicemail" },
  })
})
