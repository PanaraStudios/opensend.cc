// @vitest-environment node
import { CALLING_TEST_SDP as SDP } from "../lib/meta/calling-fixtures"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import {
  inboundFixture,
  envelope,
  PHONE_ID,
  fakeGraph,
  graphError,
  signedWebhook,
  APP_SECRET,
} from "./testHelpers/meta.fixture"
import { signRequest, HmacVerifier } from "../services/call-gateway/src/auth"
import { CallGatewayClient } from "../services/call-gateway/src/client"
import workpoolTest from "@convex-dev/workpool/test"
import { createHash } from "node:crypto"
import { patchRow } from "./counts"
import { upsertContact, insertContact } from "./audience"
import { upsertChannelThread, recordWhatsAppUser } from "./channels/identity"
import { writableCallingSettings } from "../lib/meta/calling"
import { actionError } from "../lib/action-error"
import { MetaError, parseGraphError } from "../lib/meta/errors"
import { graphFailure } from "./meta/graph"
const BSUID = "US.13491208655302741918"
const secret = "a".repeat(64)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-key-".repeat(6))
  vi.stubEnv("CALL_GATEWAY_URL", "")
  vi.stubEnv("CALL_GATEWAY_SECRET", "")
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function setup() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Calling", permission: "full_access", domainId: null },
  })
  const caller = await f.t.run(async (ctx) => {
    const row = await ctx.db
      .query("apiKeys")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .first()
    return {
      organizationId: f.owner.team,
      permission: "full_access" as const,
      apiKeyId: row!._id,
      name: "Calling",
    }
  })
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    token = key.token,
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
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }
  const project = async (value: unknown, field = "calls") => {
    const body = envelope(value, field)
    const response = await f.t.fetch(
      "/meta/webhook",
      await signedWebhook(APP_SECRET, body)
    )
    expect(response.status).toBe(200)
    const row = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").order("desc").first()
    )
    await f.t.mutation(internal.calling.projection.project, { id: row!._id })
    return row!
  }
  const webhook = (calls: unknown[] = [], statuses: unknown[] = []) => ({
    metadata: { phone_number_id: PHONE_ID },
    contacts: [
      {
        user_id: BSUID,
        profile: { name: "Username caller", username: "caller" },
      },
    ],
    calls,
    statuses,
  })
  return { ...f, caller, token: key.token, request, project, webhook }
}
test("BSUID-only connect/terminate/status fixtures are durable, idempotent and cannot resurrect terminated calls", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const ended = {
    id: "wacid.out-of-order",
    event: "terminate",
    direction: "USER_INITIATED",
    from_user_id: BSUID,
    timestamp: String(now + 40),
    status: ["COMPLETED"],
    start_time: String(now),
    end_time: String(now + 40),
    duration: 40,
    biz_opaque_callback_data: "CRM-42",
  }
  await f.project(f.webhook([ended]))
  await f.project(
    f.webhook([
      {
        id: ended.id,
        event: "connect",
        direction: "USER_INITIATED",
        from_user_id: BSUID,
        timestamp: String(now),
        session: { sdp_type: "offer", sdp: SDP },
        cta_payload: "click",
        deeplink_payload: "link",
      },
    ])
  )
  await f.project(
    f.webhook(
      [],
      [
        {
          id: ended.id,
          type: "call",
          status: "RINGING",
          timestamp: String(now + 90),
          recipient_user_id: BSUID,
        },
      ]
    )
  )
  const event = await f.project(f.webhook([ended]))
  await f.t.mutation(internal.calling.projection.project, { id: event._id })
  const rows = await f.t.run((ctx) => ctx.db.query("calls").collect())
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    status: "completed",
    userId: BSUID,
    duration: 40,
    ctaPayload: "click",
    bizOpaqueCallbackData: "CRM-42",
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("callEvents").collect())
  ).toHaveLength(3)
  expect(
    await f.t.run((ctx) => ctx.db.query("channelContacts").collect())
  ).toHaveLength(1)
  expect((await f.request(`/whatsapp/calls/${rows[0]._id}`)).status).toBe(200)
  const outsider = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other", permission: "full_access", domainId: null },
  })
  expect(
    (
      await f.request(
        `/whatsapp/calls/${rows[0]._id}`,
        "GET",
        undefined,
        outsider.token
      )
    ).status
  ).toBe(404)
  const list = await (await f.request("/whatsapp/calls")).json()
  expect(list.data[0]).toMatchObject({ user_id: BSUID, status: "completed" })
  const thread = await f.t.run((ctx) =>
    ctx.db.get("conversations", rows[0].conversationId!)
  )
  expect(thread?.windowExpiresAt).toBe((now + 40 + 86400) * 1000)
})
test("BIC statuses and API connect answer advance monotonically, and accept/reject/terminate Graph payloads are exact", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "permanent" },
        actions: [
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: (call) =>
        (call.body as { action: string }).action === "connect"
          ? { calls: [{ id: "wacid.bic" }] }
          : { success: true },
    },
  ])
  const response = await f.request("/whatsapp/calls", "POST", {
    recipient: BSUID,
    route: "api",
    session: { sdp_type: "offer", sdp: SDP },
    recording: {
      status: "ENABLED",
      purpose: "Support",
      announcement_language: "en",
    },
  })
  expect(response.status).toBe(200)
  const outbound = await response.json()
  expect(graph.to(`/${PHONE_ID}/calls`)[0].body).toMatchObject({
    messaging_product: "whatsapp",
    action: "connect",
    recipient: BSUID,
    session: { sdp_type: "offer", sdp: SDP },
    recording: { status: "ENABLED", purpose: "Support" },
  })
  await f.project(
    f.webhook(
      [],
      [
        {
          id: "wacid.bic",
          type: "call",
          status: "ACCEPTED",
          timestamp: String(now + 5),
          recipient_user_id: BSUID,
        },
      ]
    )
  )
  await f.project(
    f.webhook(
      [],
      [
        {
          id: "wacid.bic",
          type: "call",
          status: "RINGING",
          timestamp: String(now + 10),
          recipient_user_id: BSUID,
        },
      ]
    )
  )
  await f.project(
    f.webhook([
      {
        id: "wacid.bic",
        event: "connect",
        direction: "BUSINESS_INITIATED",
        to_user_id: BSUID,
        timestamp: String(now + 15),
        session: { sdp_type: "answer", sdp: SDP },
      },
    ])
  )
  const detail = await (
    await f.request(`/whatsapp/calls/${outbound.id}`)
  ).json()
  expect(detail).toMatchObject({
    status: "connected",
    session: { sdp_type: "answer" },
  })
  await f.project(
    f.webhook([
      {
        id: "wacid.uic",
        event: "connect",
        direction: "USER_INITIATED",
        from_user_id: BSUID,
        timestamp: String(now + 20),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const inbound = await f.t.run((ctx) =>
    ctx.db
      .query("calls")
      .withIndex("by_accountId_and_wacid", (q) =>
        q.eq("accountId", f.account).eq("wacid", "wacid.uic")
      )
      .unique()
  )
  for (const action of ["pre_accept", "accept"] as const)
    expect(
      (
        await f.request(`/whatsapp/calls/${inbound!._id}/${action}`, "POST", {
          session: { sdp_type: "answer", sdp: SDP },
        })
      ).status
    ).toBe(200)
  expect(
    (await f.request(`/whatsapp/calls/${inbound!._id}/terminate`, "POST"))
      .status
  ).toBe(200)
  const actions = graph.to(`/${PHONE_ID}/calls`).map((c) => c.body)
  expect(actions).toContainEqual({
    messaging_product: "whatsapp",
    action: "pre_accept",
    call_id: "wacid.uic",
    session: { sdp_type: "answer", sdp: SDP },
  })
  expect(actions).toContainEqual({
    messaging_product: "whatsapp",
    action: "terminate",
    call_id: "wacid.uic",
  })
})
test("permission replies key BSUIDs and stale replies do not overwrite a permanent grant; both Graph vocabularies and limits are preserved", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const message = (id: string, at: number, response: string) => ({
    id,
    type: "interactive",
    from_user_id: BSUID,
    timestamp: String(at),
    context: { id: "wamid.request" },
    interactive: {
      type: "call_permission_reply",
      call_permission_reply: {
        response,
        is_permanent: true,
        response_source: "user_action",
      },
    },
  })
  await f.project(
    { ...f.webhook(), messages: [message("wamid.reply", now + 3, "accept")] },
    "messages"
  )
  await f.project(
    { ...f.webhook(), messages: [message("wamid.old", now, "reject")] },
    "messages"
  )
  const permissions = await f.t.run((ctx) =>
    ctx.db.query("callPermissions").collect()
  )
  expect(permissions).toHaveLength(1)
  expect(permissions[0]).toMatchObject({ identity: BSUID, status: "permanent" })
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "granted" },
        actions: [
          {
            action_name: "start_call",
            can_perform_action: true,
            limits: [{ max_allowed: 100, current_usage: 2 }],
          },
        ],
      }),
    },
  ])
  const data = await (
    await f.request(`/whatsapp/call-permissions?recipient=${BSUID}`)
  ).json()
  expect(data.permission.status).toBe("granted")
  expect(data.actions[0].limits[0].max_allowed).toBe(100)
  expect(g.calls[0].query).toEqual({ recipient: BSUID })
  expect(
    (await f.request("/whatsapp/call-permissions?recipient=123456")).status
  ).toBe(200)
  expect(g.calls.at(-1)?.query).toEqual({ recipient: "123456" })
  g.use({
    path: `/${PHONE_ID}/call_permissions`,
    respond: () => ({
      permission: { status: "temporary", expiration_time: now + 600 },
      actions: [],
    }),
  })
  expect(
    (
      await (
        await f.request(`/whatsapp/call-permissions?recipient=${BSUID}`)
      ).json()
    ).permission.status
  ).toBe("temporary")
})
test("Meta recording and transcript fixtures fetch fresh URLs, verify SHA-256 and store via shared storage without reopening calls", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000),
    data = Buffer.from("recording bytes"),
    sha256 = createHash("sha256").update(data).digest("base64")
  fakeGraph([
    {
      path: "/media.recording",
      respond: () => ({
        url: "https://lookaside.fbsbx.com/media",
        mime_type: "audio/ogg",
      }),
    },
    {
      path: "/media.transcript",
      respond: () => ({
        url: "https://lookaside.fbsbx.com/transcript",
        mime_type: "application/json",
      }),
    },
    { path: "/media", respond: () => new Response(data) },
    { path: "/transcript", respond: () => new Response(data) },
  ])
  await f.project(
    f.webhook([
      {
        id: "wacid.recorded",
        event: "terminate",
        timestamp: String(now),
        status: "COMPLETED",
        from_user_id: BSUID,
        duration: 20,
      },
    ])
  )
  await f.project(
    f.webhook([
      {
        id: "wacid.recorded",
        event: "call_recording_available",
        timestamp: String(now + 10),
        from_user_id: BSUID,
        call_recording: {
          type: "audio",
          audio: {
            id: "media.recording",
            sha256,
            mime_type: "audio/ogg",
            url: "https://expired.test",
          },
        },
      },
      {
        id: "wacid.recorded",
        event: "call_transcription_available",
        timestamp: String(now + 11),
        from_user_id: BSUID,
        call_transcript: {
          document: {
            id: "media.transcript",
            sha256,
            mime_type: "application/json",
          },
        },
      },
    ])
  )
  const row = await f.t.run((ctx) => ctx.db.query("calls").first())
  for (const kind of ["recording", "transcription"] as const)
    await f.t.action(internal.calling.media.fetch, { id: row!._id, kind })
  const saved = await f.t.run((ctx) => ctx.db.get("calls", row!._id))
  expect(saved?.recording?.storageId).toBeTruthy()
  expect(saved?.transcription?.storageId).toBeTruthy()
  expect(saved?.status).toBe("completed")
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events.map((e) => e.type)).toContain("whatsapp.call.recording_ready")
})
test("calling settings replace call hours whole, omit unused signaling defaults, and map Meta call errors", async () => {
  const f = await setup()
  const calling = {
    status: "ENABLED",
    call_hours: {
      status: "ENABLED",
      timezone_id: "UTC",
      weekly_operating_hours: [
        { day_of_week: "MONDAY", open_time: "0900", close_time: "1700" },
      ],
    },
    voicemail: { status: "DISABLED" },
  }
  const g = fakeGraph([
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
      respond: () => ({ permission: { status: "permanent" } }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: () => graphError("No permission", 138006),
    },
  ])
  expect(
    (
      await f.request(`/whatsapp/phone-numbers/${PHONE_ID}/calling`, "POST", {
        calling,
        handling_mode: "api",
      })
    ).status
  ).toBe(200)
  expect(g.calls[0].body).toEqual({
    calling: {
      status: "ENABLED",
      call_icon_visibility: "DEFAULT",
      call_hours: calling.call_hours,
    },
  })
  const result = await f.request("/whatsapp/calls", "POST", {
    recipient: BSUID,
    route: "api",
    session: { sdp_type: "offer", sdp: SDP },
  })
  expect(result.status).toBe(422)
  expect(await result.json()).toMatchObject({
    name: "call_permission_required",
    message: expect.stringContaining("No permission"),
  })
  expect(
    (
      await f.request(`/whatsapp/phone-numbers/${PHONE_ID}/calling`, "POST", {
        calling: { sip: { status: "ENABLED" } },
      })
    ).status
  ).toBe(422)
})

test("dashboard enables calling from Meta defaults and toggles callback permission with valid enums", async () => {
  const f = await setup()
  const remote = {
    status: "DISABLED",
    call_icon_visibility: "DEFAULT",
    callback_permission_status: "",
    audio: { additional_codecs: [] },
    call_icons: { restrict_to_user_countries: [] },
    call_hours: {
      status: "DISABLED",
      timezone_id: "UTC",
      weekly_operating_hours: [],
    },
    voicemail: { status: "DISABLED" },
    sip: { status: "DISABLED" },
    srtp_key_exchange_protocol: "DTLS",
  }
  await f.t.mutation(internal.calling.settingsState.store, {
    accountId: f.account,
    settings: JSON.stringify(remote),
    mode: "api",
  })
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/settings`,
      method: "POST",
      respond: () => ({ success: true }),
    },
    {
      path: `/${PHONE_ID}/settings`,
      method: "GET",
      respond: () => ({ calling: remote }),
    },
  ])
  const form = { ...writableCallingSettings(remote), status: "ENABLED" }
  await f.owner.client.action(api.calling.settings.dashboardUpdate, {
    organizationId: f.owner.team,
    from: f.account,
    calling: form,
  })
  expect(g.calls[0].body).toEqual({
    calling: { status: "ENABLED", call_icon_visibility: "DEFAULT" },
  })
  for (const checked of [true, false]) {
    const callback_permission_status = checked === true ? "ENABLED" : "DISABLED"
    await f.owner.client.action(api.calling.settings.dashboardUpdate, {
      organizationId: f.owner.team,
      from: f.account,
      calling: { ...form, callback_permission_status },
    })
    expect(g.to(`/${PHONE_ID}/settings`, "POST").at(-1)?.body).toEqual({
      calling: {
        status: "ENABLED",
        call_icon_visibility: "DEFAULT",
        callback_permission_status,
      },
    })
  }
  const posts = g.to(`/${PHONE_ID}/settings`, "POST").length
  await expect(
    f.owner.client.action(api.calling.settings.dashboardUpdate, {
      organizationId: f.owner.team,
      from: f.account,
      calling: { callback_permission_status: true },
    })
  ).rejects.toThrow("callback_permission_status must be ENABLED or DISABLED")
  expect(g.to(`/${PHONE_ID}/settings`, "POST")).toHaveLength(posts)
})

test("settings errors reach the API and dashboard toast with every Meta reason field, never the token", async () => {
  const f = await setup()
  const details = "callback_permission_status must be ENABLED or DISABLED"
  const body = {
    error: {
      code: 100,
      message: "(#100) Invalid parameter connection-test-token",
      error_user_title: "Invalid calling settings",
      error_user_msg: "Check callback permission",
      error_data: { details },
      access_token: "connection-test-token",
    },
  }
  fakeGraph([
    {
      path: `/${PHONE_ID}/settings`,
      respond: () => Response.json(body, { status: 400 }),
    },
  ])
  const result = await f.request(
    `/whatsapp/phone-numbers/${PHONE_ID}/calling`,
    "POST",
    { calling: { status: "ENABLED" } }
  )
  expect(result.status).toBe(422)
  const error = await result.json()
  expect(error.name).toBe("invalid_calling_settings")
  for (const reason of [
    details,
    body.error.error_user_title,
    body.error.error_user_msg,
    "(#100) Invalid parameter",
  ])
    expect(error.message).toContain(reason)
  expect(error.message).not.toContain("SDP")
  expect(JSON.stringify(error)).not.toContain("connection-test-token")
  const dashboardError = await f.owner.client
    .action(api.calling.settings.dashboardUpdate, {
      organizationId: f.owner.team,
      from: f.account,
      calling: { status: "ENABLED" },
    })
    .catch((error: unknown) => error)
  expect(actionError(dashboardError)).toBe(error.message)
  const failure = graphFailure(
    new MetaError(
      parseGraphError(400, JSON.stringify(body), ["connection-test-token"])
    )
  )
  for (const reason of [
    details,
    body.error.error_user_title,
    body.error.error_user_msg,
    "(#100) Invalid parameter",
  ])
    expect(failure).toContain(reason)
  expect(failure).not.toContain("connection-test-token")
})
test("gateway callbacks require exact HMAC, persist nonce replay protection and eventId dedupe, and never reopen ended calls", async () => {
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  await f.project(
    f.webhook([
      {
        id: "wacid.gateway",
        event: "connect",
        from_user_id: BSUID,
        timestamp: String(Math.floor(Date.now() / 1000)),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const row = await f.t.run((ctx) => ctx.db.query("calls").first())
  const data = {
    version: 1,
    eventId: crypto.randomUUID(),
    callId: row!._id,
    timestamp: Date.now(),
    event: "answer_ready",
    answerSdp: SDP,
  }
  const body = JSON.stringify(data),
    path = "/calling/gateway/events",
    headers = {
      "content-type": "application/json",
      ...signRequest(secret, "POST", path, body),
    }
  expect(
    (await f.t.fetch(path, { method: "POST", headers, body })).status
  ).toBe(200)
  expect(
    (await f.t.fetch(path, { method: "POST", headers, body })).status
  ).toBe(401)
  expect(
    (
      await f.t.fetch(path, {
        method: "POST",
        headers: signRequest(secret, "POST", path, body),
        body,
      })
    ).status
  ).toBe(200)
  expect(
    (await f.t.fetch(path, { method: "POST", headers, body: body + " " }))
      .status
  ).toBe(401)
  await f.t.mutation(internal.calling.rows.finish, {
    id: row!._id,
    status: "completed",
  })
  const mediaBody = JSON.stringify({
    ...data,
    eventId: crypto.randomUUID(),
    timestamp: Date.now() + 5000,
    event: "media_up",
  })
  expect(
    (
      await f.t.fetch(path, {
        method: "POST",
        headers: signRequest(secret, "POST", path, mediaBody),
        body: mediaBody,
      })
    ).status
  ).toBe(200)
  const ended = await f.t.run((ctx) => ctx.db.get("calls", row!._id))
  expect(ended?.status).toBe("completed")
  expect(ended?.mediaUpAt).toBeUndefined()
  expect(
    await f.t.run((ctx) => ctx.db.query("gatewayEvents").collect())
  ).toHaveLength(2)
})
test("gateway client signs exact method/path/body and refuses redirects; accept releases RTP only after Graph 200", async () => {
  const verifier = new HmacVerifier(secret),
    calls: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input),
        headers = Object.fromEntries(new Headers(init?.headers))
      verifier.verify(
        init!.method!,
        url.pathname,
        init!.body as string,
        headers
      )
      expect(init?.redirect).toBe("error")
      calls.push(url.pathname)
      return Response.json(
        url.pathname === "/inbound" ? { answerSdp: SDP } : { ok: true }
      )
    })
  )
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/calls`,
      respond: (call) => {
        calls.push((call.body as { action: string }).action)
        return { success: true }
      },
    },
  ])
  await f.project(
    f.webhook([
      {
        id: "wacid.accept",
        event: "connect",
        from_user_id: BSUID,
        timestamp: String(Math.floor(Date.now() / 1000)),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const row = await f.t.run((ctx) => ctx.db.query("calls").first())
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: row!._id,
  })
  expect(calls).toEqual(["/inbound", "pre_accept"])
  const body = await (
    await f.request(`/whatsapp/calls/${row!._id}/accept`, "POST", {})
  ).json()
  expect(body.success).toBe(true)
  expect(calls).toEqual(["/inbound", "pre_accept", "accept", "/route"])
  g.use({
    path: `/${PHONE_ID}/calls`,
    respond: () => graphError("Call unavailable", 138000),
  })
  await new CallGatewayClient("http://gateway.test", secret).hangup(row!._id)
})

test("an SDP answer arriving after a newer status is forwarded without regression, and Graph webhook races keep the client call id", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const id = await f.t.mutation(internal.calling.rows.create, {
    organizationId: f.owner.team,
    caller: f.caller,
    recipient: BSUID,
    mode: "api",
  })
  await f.project(
    f.webhook(
      [],
      [
        {
          id: "wacid.race",
          type: "call",
          recipient_user_id: BSUID,
          status: "ACCEPTED",
          timestamp: String(now + 2),
        },
      ]
    )
  )
  await f.project(
    f.webhook([
      {
        id: "wacid.race",
        to_user_id: BSUID,
        event: "connect",
        direction: "BUSINESS_INITIATED",
        timestamp: String(now + 1),
        session: { sdp_type: "answer", sdp: SDP },
      },
    ])
  )
  expect(await f.t.run((ctx) => ctx.db.query("calls").collect())).toHaveLength(
    1
  )
  const row = await f.t.run((ctx) => ctx.db.get("calls", id))
  expect(row).toMatchObject({
    wacid: "wacid.race",
    status: "connected",
    remoteSession: { sdp_type: "answer" },
  })
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(
    events.filter((e) => e.type === "whatsapp.call.connected").at(-1)?.data
  ).toMatchObject({ id, session: { sdp_type: "answer", sdp: SDP } })
})
test("rejection always signals terminate, terminal metadata is enriched, and API keys cannot use sending-only access", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const g = fakeGraph([
    { path: `/${PHONE_ID}/calls`, respond: () => ({ success: true }) },
  ])
  await f.project(
    f.webhook([
      {
        id: "wacid.reject",
        event: "connect",
        from_user_id: BSUID,
        timestamp: String(now),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const row = await f.t.run((ctx) => ctx.db.query("calls").first())
  expect(
    (await f.request(`/whatsapp/calls/${row!._id}/reject`, "POST", {})).status
  ).toBe(200)
  expect(g.calls.map((c) => (c.body as { action: string }).action)).toEqual([
    "reject",
    "terminate",
  ])
  await f.project(
    f.webhook([
      {
        id: "wacid.reject",
        event: "terminate",
        from_user_id: BSUID,
        timestamp: String(now + 20),
        status: "FAILED",
        duration: 0,
      },
    ])
  )
  expect(await f.t.run((ctx) => ctx.db.get("calls", row!._id))).toMatchObject({
    status: "rejected",
    duration: 0,
  })
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Sending", permission: "sending_access", domainId: null },
  })
  expect(
    (await f.request("/whatsapp/calls", "GET", undefined, key.token)).status
  ).toBe(403)
})
test("a failed gateway accept cannot release RTP and sends termination with media cleanup", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000),
    paths: string[] = []
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      paths.push(new URL(input).pathname)
      return Response.json({ answerSdp: SDP, ok: true })
    })
  )
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/calls`,
      respond: (c) =>
        (c.body as { action: string }).action === "accept"
          ? graphError("Disabled", 138000)
          : { success: true },
    },
  ])
  await f.project(
    f.webhook([
      {
        id: "wacid.gateway-failed",
        event: "connect",
        from_user_id: BSUID,
        timestamp: String(now),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const row = await f.t.run((ctx) => ctx.db.query("calls").first())
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: row!._id,
  })
  expect(
    (await f.request(`/whatsapp/calls/${row!._id}/accept`, "POST", {})).status
  ).toBe(422)
  expect(paths).not.toContain("/route")
  expect(paths).toContain("/hangup")
  expect(g.calls.map((c) => (c.body as { action: string }).action)).toContain(
    "terminate"
  )
  expect(await f.t.run((ctx) => ctx.db.get("calls", row!._id))).toMatchObject({
    status: "failed",
  })
})

test("permission requests use the shared message pipeline for both free-form and approved template payloads", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000)
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "no_permission" },
        actions: [
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      }),
    },
    {
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: crypto.randomUUID() }] }),
    },
  ])
  const closed = await f.request("/whatsapp/call-permissions", "POST", {
    recipient: BSUID,
    text: "May we call?",
  })
  expect(closed.status).toBe(422)
  await f.project(
    f.webhook([
      {
        id: "wacid.permission-window",
        event: "connect",
        from_user_id: BSUID,
        timestamp: String(now),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  const request = await f.request("/whatsapp/call-permissions", "POST", {
    recipient: BSUID,
    text: "May we call?",
  })
  expect(request.status).toBe(200)
  const { id } = await request.json()
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  expect(g.calls.at(-1)?.body).toMatchObject({
    recipient: BSUID,
    interactive: {
      type: "call_permission_request",
      action: { name: "call_permission_request" },
      body: { text: "May we call?" },
    },
  })
  // Meta's request limits reset after a connected call; use a fresh recipient to test the template shape.
  const template = await f.request("/whatsapp/call-permissions", "POST", {
    recipient: "US.43",
    template: {
      name: "permission_request",
      language: "en_US",
      components: [
        { type: "body", parameters: [{ type: "text", text: "Ada" }] },
      ],
    },
  })
  expect(template.status).toBe(200)
  await f.t.action(internal.channels.deliver.deliver, {
    id: (await template.json()).id,
    generation: 0,
  })
  expect(g.calls.at(-1)?.body).toMatchObject({
    type: "template",
    template: { name: "permission_request", language: { code: "en_US" } },
  })
})
test("gateway BIC passes the answer before routing, missed calls emit events and local recording callbacks persist their finalized file", async () => {
  const f = await setup(),
    paths: string[] = [],
    now = Math.floor(Date.now() / 1000)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      paths.push(new URL(input).pathname)
      return Response.json({ offerSdp: SDP, ok: true })
    })
  )
  fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "permanent" },
        actions: [
          {
            action_name: "send_call_permission_request",
            can_perform_action: true,
          },
        ],
      }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: (call) =>
        (call.body as { action: string }).action === "connect"
          ? { calls: [{ id: "wacid.gateway-bic" }] }
          : { success: true },
    },
  ])
  const created = await (
    await f.request("/whatsapp/calls", "POST", {
      recipient: BSUID,
      route: "gateway",
    })
  ).json()
  await f.project(
    f.webhook([
      {
        id: "wacid.gateway-bic",
        event: "connect",
        direction: "BUSINESS_INITIATED",
        to_user_id: BSUID,
        timestamp: String(now + 2),
        session: { sdp_type: "answer", sdp: SDP },
      },
    ])
  )
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: created.id,
  })
  expect(paths).toEqual(["/outbound", "/remoteAnswer", "/route"])
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const root = await mkdtemp(join(tmpdir(), "calling-recording-")),
    filename = `${crypto.randomUUID()}.wav`
  try {
    vi.stubEnv("CALL_GATEWAY_RECORDINGS_DIR", root)
    await writeFile(join(root, filename), "finalized WAV fixture")
    const data = {
        version: 1,
        eventId: crypto.randomUUID(),
        callId: created.id,
        timestamp: Date.now(),
        event: "recording_ready",
        recordingFile: `/recordings/${filename}`,
      },
      body = JSON.stringify(data),
      path = "/calling/gateway/events"
    expect(
      (
        await f.t.fetch(path, {
          method: "POST",
          headers: signRequest(secret, "POST", path, body),
          body,
        })
      ).status
    ).toBe(200)
    await f.t.action(internal.calling.media.gatewayRecording, {
      id: created.id,
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("calls", created.id)))?.recording
        ?.storageId
    ).toBeTruthy()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  await f.project(
    f.webhook([
      {
        id: "wacid.missed",
        event: "terminate",
        from_user_id: BSUID,
        direction: "USER_INITIATED",
        timestamp: String(now + 10),
        status: "FAILED",
        duration: 0,
      },
    ])
  )
  expect(
    (await f.t.run((ctx) => ctx.db.query("events").collect())).map(
      (e) => e.type
    )
  ).toContain("whatsapp.call.missed")
})

test("phone lookups select this business's BSUID alias instead of the last business that updated the contact", async () => {
  const f = await setup(),
    now = Math.floor(Date.now() / 1000),
    phone = "16505551234"
  await f.project(
    f.webhook([
      {
        id: "wacid.known-phone",
        event: "connect",
        from: phone,
        from_user_id: BSUID,
        timestamp: String(now),
        session: { sdp_type: "offer", sdp: SDP },
      },
    ])
  )
  await f.t.run(async (ctx) => {
    const identity = (await ctx.db.query("channelContacts").first())!
    await ctx.db.insert("whatsappUserAliases", {
      organizationId: f.owner.team,
      businessId: "other-business",
      userId: "US.other",
      channelContactId: identity._id,
    })
    await ctx.db.patch("channelContacts", identity._id, {
      userId: "US.other",
      userScopeId: "other-business",
    })
  })
  const g = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({ permission: { status: "permanent" }, actions: [] }),
    },
  ])
  expect(
    (await f.request(`/whatsapp/call-permissions?to=${phone}`)).status
  ).toBe(200)
  expect(g.calls[0].query).toEqual({ recipient: BSUID })
  expect(
    (await f.t.run((ctx) => ctx.db.query("callPermissions").first()))?.identity
  ).toBe(BSUID)
})

test("a call committed before an interrupted Graph action is durably expired instead of remaining queued", async () => {
  const f = await setup()
  const id = await f.t.mutation(internal.calling.rows.create, {
    organizationId: f.owner.team,
    caller: f.caller,
    recipient: BSUID,
    mode: "api",
  })
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(61000))
  expect(await f.t.run((ctx) => ctx.db.get("calls", id))).toMatchObject({
    status: "failed",
    error: "Call setup timed out before Meta assigned a call id.",
  })
})

test.each([false, true])(
  "BSUID-only calls resolve a legacy phone identity and backfill later webhook links: earlier duplicate=%s",
  async (earlierDuplicate) => {
    const f = await setup()
    const links = await f.t.run(async (ctx) => {
      const account = (await ctx.db.get("channelAccounts", f.account))!
      const contact = await upsertContact(
        ctx,
        f.owner.team,
        { phone: "+919316108172", firstName: "Kamal" },
        { properties: [], segmentIds: [], skipExisting: true }
      )
      const links = await upsertChannelThread(ctx, account, {
        externalId: "919316108172",
        phone: "+919316108172",
        profileName: "Kamal",
        at: Date.now(),
        direction: "inbound",
        preview: "Hello",
      })
      // Reproduce the older message identity: userId exists, but no alias or business scope.
      await ctx.db.patch("channelContacts", links.channelContactId, {
        userId: BSUID,
        contactId: contact.id,
      })
      if (earlierDuplicate) {
        const connection = (await ctx.db.get(
          "metaConnections",
          account.connectionId
        ))!
        const orphanContact = await insertContact(ctx, f.owner.team, {
          firstName: "Caller",
          lastName: "",
        })
        const orphan = await ctx.db.insert("channelContacts", {
          organizationId: f.owner.team,
          channel: "whatsapp",
          scopeId: `whatsapp:${connection.businessId}`,
          externalId: BSUID,
          userId: BSUID,
          contactId: orphanContact,
          marketingOptOut: false,
        })
        await recordWhatsAppUser(ctx, account, orphan, BSUID)
      }
      return { ...links, contactId: contact.id }
    })
    const connect = {
      id: "wacid.kamal",
      event: "connect",
      direction: "USER_INITIATED",
      from_user_id: BSUID,
      timestamp: String(Math.floor(Date.now() / 1000)),
    }
    await f.project(f.webhook([connect]))
    let call = (await f.t.run((ctx) => ctx.db.query("calls").first()))!
    expect(call).toMatchObject(links)
    const identities = await f.t.run((ctx) =>
      ctx.db.query("channelContacts").collect()
    )
    expect(
      identities.filter((identity) => !identity.mergedIntoId)
    ).toHaveLength(1)
    const list = await f.owner.client.query(api.calling.rows.dashboardList, {
      organizationId: f.owner.team,
      limit: 25,
    })
    expect(list.data[0]).toMatchObject({
      contact_name: "Kamal",
      contact_phone: "+919316108172",
      contact_id: links.contactId,
    })
    const detail = await f.t.query(internal.calling.rows.get, {
      organizationId: f.owner.team,
      caller: f.caller,
      id: call._id,
    })
    expect(detail).toMatchObject({
      contact_name: "Kamal",
      contact_phone: "+919316108172",
    })
    await f.t.run((ctx) =>
      ctx.db.patch("calls", call._id, {
        contactId: undefined,
        channelContactId: undefined,
      })
    )
    await f.project(
      f.webhook([{ ...connect, event: "terminate", status: "COMPLETED" }])
    )
    call = (await f.t.run((ctx) => ctx.db.get("calls", call._id)))!
    expect(call).toMatchObject(links)
    // An enriched replay repairs old rows without duplicating the lifecycle event.
    await f.t.run((ctx) =>
      ctx.db.patch("calls", call._id, {
        contactId: undefined,
        channelContactId: undefined,
      })
    )
    await f.project(f.webhook([{ ...connect, from: "919316108172" }]))
    expect(await f.t.run((ctx) => ctx.db.get("calls", call._id))).toMatchObject(
      links
    )
    expect(
      await f.t.run((ctx) => ctx.db.query("callEvents").collect())
    ).toHaveLength(2)
  }
)

test("unknown BSUID callers use profile names or a readable WhatsApp fallback", async () => {
  const f = await setup()
  await f.project({
    metadata: { phone_number_id: PHONE_ID },
    calls: [{ id: "wacid.unknown", event: "connect", from_user_id: BSUID }],
  })
  const list = await f.owner.client.query(api.calling.rows.dashboardList, {
    organizationId: f.owner.team,
    limit: 25,
  })
  expect(list.data[0]).toMatchObject({
    contact_name: "WhatsApp user",
    contact_phone: null,
  })
})

async function botRouteFixture() {
  const f = await setup()
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  const credential = await (
    await f.request("/voice-providers", "POST", {
      provider: "gemini",
      label: "Fixture",
      key: "fixture credential",
    })
  ).json()
  const response = await f.request("/voice-bots", "POST", {
    name: "Coach",
    provider: "gemini",
    engine: "gemini_live",
    credentialId: credential.id,
    systemPrompt: "Coach instructions",
    greeting: "Hello Ada",
    tools: ["lookup_contact"],
  })
  expect(response.status).toBe(200)
  const bot = await response.json()
  const contactId = await f.t.run(
    async (ctx) =>
      (
        await upsertContact(
          ctx,
          f.owner.team,
          { phone: "+919999000011", firstName: "Ada" },
          { properties: [], segmentIds: [], skipExisting: false }
        )
      ).id
  )
  const paths: string[] = [],
    routes: Record<string, unknown>[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const path = new URL(input).pathname
      paths.push(path)
      if (path === "/route") routes.push(JSON.parse(String(init?.body)))
      return Response.json({ offerSdp: SDP, ok: true })
    })
  )
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission: { status: "permanent" },
        actions: [{ action_name: "start_call", can_perform_action: true }],
      }),
    },
    {
      path: `/${PHONE_ID}/calls`,
      respond: (call) =>
        (call.body as { action: string }).action === "connect"
          ? { calls: [{ id: "wacid.bot-outbound" }] }
          : { success: true },
    },
  ])
  return { ...f, botId: bot.id, contactId, graph, paths, routes }
}
test("CRM bot calls generate an offer, apply Meta's answer, route once and include purpose and variables in the signed bot session", async () => {
  const f = await botRouteFixture()
  const result = await f.request("/whatsapp/calls", "POST", {
    from: f.account,
    contact_id: f.contactId,
    route: `bot:${f.botId}`,
    context: "Follow up after the seminar",
    variables: { seminar: "Saturday" },
  })
  expect(result.status).toBe(200)
  const body = await result.json()
  expect(body.status).toBe("ringing")
  expect(f.graph.to(`/${PHONE_ID}/call_permissions`)[0].query).toEqual({
    user_wa_id: "919999000011",
  })
  expect(f.graph.to(`/${PHONE_ID}/calls`)[0].body).toEqual({
    messaging_product: "whatsapp",
    action: "connect",
    to: "919999000011",
    session: { sdp_type: "offer", sdp: SDP },
  })
  await f.project({
    metadata: { phone_number_id: PHONE_ID },
    contacts: [{ wa_id: "919999000011", user_id: BSUID }],
    calls: [
      {
        id: "wacid.bot-outbound",
        event: "connect",
        direction: "BUSINESS_INITIATED",
        to: "919999000011",
        to_user_id: BSUID,
        timestamp: String(Math.floor(Date.now() / 1000)),
        session: { sdp_type: "answer", sdp: SDP },
      },
    ],
  })
  await f.t.action(internal.calling.callActions.gatewayConnect, { id: body.id })
  await f.t.action(internal.calling.callActions.gatewayConnect, { id: body.id })
  expect(f.paths).toEqual(["/outbound", "/remoteAnswer", "/route"])
  expect(f.routes[0]).toMatchObject({ target: "bot", botId: f.botId })
  const requestBody = JSON.stringify({
    version: 1,
    callId: body.id,
    organizationId: f.owner.team,
  })
  const session = await f.t.fetch("/calling/gateway/voice/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...signRequest(
        secret,
        "POST",
        "/calling/gateway/voice/session",
        requestBody
      ),
    },
    body: requestBody,
  })
  expect(session.status).toBe(200)
  expect(await session.json()).toMatchObject({
    greeting: "Hello Ada",
    callDirection: "outbound",
    systemPrompt: expect.stringContaining('"seminar":"Saturday"'),
  })
  const call = await (await f.request(`/whatsapp/calls/${body.id}`)).json()
  expect(call).toMatchObject({
    contact_id: f.contactId,
    direction: "outbound",
    outcome: "answered",
    attempt: 1,
    purpose: "Follow up after the seminar",
  })
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events.map((event) => event.type)).toContain("call.outbound_connected")
})
test("missing, denied and expired permissions never allocate gateway media; optional requests obey Meta and queued request limits", async () => {
  const f = await botRouteFixture()
  const input = {
    from: f.account,
    contact_id: f.contactId,
    route: `bot:${f.botId}`,
  }
  for (const permission of [
    { status: "denied" },
    { status: "temporary", expiration_time: Math.floor(Date.now() / 1000) - 1 },
  ]) {
    f.graph.use({
      path: `/${PHONE_ID}/call_permissions`,
      respond: () => ({
        permission,
        actions: [{ action_name: "start_call", can_perform_action: true }],
      }),
    })
    const response = await f.request("/whatsapp/calls", "POST", input)
    expect(await response.json()).toMatchObject({
      status: "permission_required",
    })
  }
  f.graph.use({
    path: `/${PHONE_ID}/call_permissions`,
    respond: () => ({
      permission: { status: "permanent" },
      actions: [{ action_name: "start_call", can_perform_action: false }],
    }),
  })
  expect(
    await (await f.request("/whatsapp/calls", "POST", input)).json()
  ).toMatchObject({ status: "calling_limited" })
  expect(f.paths).toEqual([])
  const identity = await f.t.run(async (ctx) => {
    const account = (await ctx.db.get("channelAccounts", f.account))!
    return upsertChannelThread(ctx, account, {
      externalId: "919999000011",
      phone: "+919999000011",
      at: Date.now(),
      direction: "inbound",
      preview: "Seminar signup",
      opensWindow: true,
    })
  })
  expect(identity.contactId).toBe(f.contactId)
  f.graph.use({
    path: `/${PHONE_ID}/call_permissions`,
    respond: () => ({
      permission: { status: "no_permission" },
      actions: [
        {
          action_name: "send_call_permission_request",
          can_perform_action: true,
        },
      ],
    }),
  })
  const queued = await f.request("/whatsapp/calls", "POST", {
    ...input,
    request_permission: true,
  })
  expect(queued.status).toBe(200)
  expect(await queued.json()).toMatchObject({
    status: "permission_requested",
    permission_request_id: expect.any(String),
  })
  const second = await f.request(
    `/contacts/${f.contactId}/call-permission`,
    "POST",
    { from: f.account }
  )
  expect(second.status).toBe(429)
  expect(f.paths).toEqual([])
  const read = await f.request(
    `/contacts/${f.contactId}/call-permission?from=${f.account}`
  )
  expect(read.status).toBe(200)
  expect(await read.json()).toMatchObject({
    permission: { status: "no_permission" },
  })
})
test("Meta 138013 is readable, persists the failure code, cleans up the gateway, and idempotent retries never redial", async () => {
  const f = await botRouteFixture()
  f.graph.use({
    path: `/${PHONE_ID}/calls`,
    respond: () =>
      graphError(
        "Business-initiated calling is unavailable for this US test number",
        138013
      ),
  })
  const payload = {
    from: f.account,
    contact_id: f.contactId,
    route: `bot:${f.botId}`,
  }
  const response = await f.request(
    "/whatsapp/calls",
    "POST",
    payload,
    f.token,
    "country-failure"
  )
  expect(response.status).toBe(422)
  const error = await response.json()
  expect(error).toMatchObject({
    name: "calling_country_unavailable",
    message: expect.stringContaining("US test number"),
  })
  const retry = await f.request(
    "/whatsapp/calls",
    "POST",
    payload,
    f.token,
    "country-failure"
  )
  expect(retry.status).toBe(422)
  expect(await retry.json()).toEqual(error)
  expect(f.graph.to(`/${PHONE_ID}/calls`)).toHaveLength(1)
  const calls = await f.t.run((ctx) => ctx.db.query("calls").collect())
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    status: "failed",
    errorCode: 138013,
    error: expect.stringContaining("US test number"),
  })
  expect(f.paths).toEqual(["/outbound", "/hangup"])
  expect(
    await (await f.request(`/whatsapp/calls/${calls[0]._id}`)).json()
  ).toMatchObject({ outcome: "failed", error_code: 138013 })
})

async function automationFixture() {
  const f = await botRouteFixture()
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  const create = async (trigger: string, graph: unknown[]) => {
    const id = await f.owner.client.mutation(api.automations.create, {
      organizationId: f.owner.team,
    })
    await f.owner.client.mutation(api.automations.update, {
      organizationId: f.owner.team,
      id,
      trigger,
      graph: JSON.stringify(graph),
    })
    expect(
      await f.owner.client.mutation(api.automations.setStatus, {
        organizationId: f.owner.team,
        id,
        status: "enabled",
      })
    ).toEqual([])
    return id
  }
  const tick = async (ms = 5000) => {
    for (let i = 0; i < ms / 100; i++) {
      vi.advanceTimersByTime(100)
      await f.t.finishInProgressScheduledFunctions()
    }
  }
  return { ...f, create, tick }
}
test("lead automation waits then places one bot call with resolved lead variables; unsubscribed leads are skipped", async () => {
  const f = await automationFixture()
  const id = await f.create("seminar.signup", [
    { key: "wait", type: "delay", duration: "1 minute" },
    {
      key: "call",
      type: "place_call",
      accountId: f.account,
      route: `bot:${f.botId}`,
      purpose: "event.purpose",
      variables: { name: "contact.first_name", seminar: "event.seminar" },
      requestPermission: false,
    },
  ])
  const run = async () =>
    f.owner.client.mutation(api.automations.test, {
      organizationId: f.owner.team,
      id,
      contactId: f.contactId,
      payload: { purpose: "Follow up on signup", seminar: "Saturday" },
    })
  const runId = await run()
  await f.tick()
  expect(f.paths).toEqual([])
  await f.tick(61000)
  expect(
    await f.t.run((ctx) => ctx.db.get("automationRuns", runId))
  ).toMatchObject({ status: "completed" })
  const calls = await f.t.run((ctx) => ctx.db.query("calls").collect())
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({
    outboundRoute: { kind: "bot", botId: f.botId },
    callPurpose: "Follow up on signup",
    callVariables: { name: "Ada", seminar: "Saturday" },
  })
  expect(
    await f.owner.client.query(api.automations.runSteps, {
      organizationId: f.owner.team,
      runId,
    })
  ).toContainEqual(
    expect.objectContaining({
      key: "call",
      status: "completed",
      output: expect.objectContaining({ status: "ringing", id: calls[0]._id }),
    })
  )
  const second = await run()
  await f.tick()
  await f.t.run((ctx) =>
    patchRow(ctx, "contacts", f.contactId, { unsubscribed: true })
  )
  await f.tick(61000)
  expect(
    await f.owner.client.query(api.automations.runSteps, {
      organizationId: f.owner.team,
      runId: second,
    })
  ).toContainEqual(
    expect.objectContaining({
      key: "call",
      status: "skipped",
      output: { status: "skipped", reason: "unsubscribed" },
    })
  )
  expect(await f.t.run((ctx) => ctx.db.query("calls").collect())).toHaveLength(
    1
  )
})
test("permission replies update the contact identity, ignore replay/stale denial and trigger subscribed automations and webhooks", async () => {
  const f = await automationFixture()
  await f.t.run(async (ctx) => {
    const account = (await ctx.db.get("channelAccounts", f.account))!
    await upsertChannelThread(ctx, account, {
      externalId: "919999000011",
      phone: "+919999000011",
      at: Date.now(),
      direction: "inbound",
      preview: "Signup",
      opensWindow: true,
    })
  })
  await f.create("call.permission_granted", [
    {
      key: "update",
      type: "contact_update",
      fields: [
        {
          property: "last_name",
          action: "change",
          value: "Permission granted",
        },
      ],
    },
  ])
  await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://example.com/calling",
    events: ["call.permission_granted", "call.permission_denied"],
  })
  const now = Math.floor(Date.now() / 1000)
  const reply = (id: string, timestamp: number, response: string) => ({
    metadata: { phone_number_id: PHONE_ID },
    messages: [
      {
        id,
        from: "919999000011",
        from_user_id: BSUID,
        timestamp: String(timestamp),
        type: "interactive",
        interactive: {
          type: "call_permission_reply",
          call_permission_reply: {
            response,
            is_permanent: false,
            expiration_timestamp: String(now + 604800),
          },
        },
      },
    ],
  })
  await f.project(reply("wamid.accept", now, "accept"), "messages")
  await f.project(reply("wamid.accept", now, "accept"), "messages")
  await f.project(reply("wamid.stale-denial", now - 1, "reject"), "messages")
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(
    events.filter((e) => e.type === "call.permission_granted")
  ).toHaveLength(1)
  expect(
    events.filter((e) => e.type === "call.permission_denied")
  ).toHaveLength(0)
  const event = events.find((e) => e.type === "call.permission_granted")!
  expect(event.data.contact_id).toBe(f.contactId)
  await f.t.mutation(internal.automationRuntime.dispatch, {
    id: event._id,
    phase: "start",
    cursor: null,
  })
  await f.t.mutation(internal.webhooks.deliverEvent, { id: event._id })
  await f.tick()
  expect(
    await f.t.run((ctx) => ctx.db.get("contacts", f.contactId))
  ).toMatchObject({ lastName: "Permission granted" })
  expect(
    await f.t.run((ctx) => ctx.db.query("webhookDeliveries").collect())
  ).toContainEqual(
    expect.objectContaining({
      event: "call.permission_granted",
      payload: expect.objectContaining({
        data: expect.objectContaining({ contact_id: f.contactId }),
      }),
    })
  )
  const cached = () =>
    f.owner.client.query(api.calling.outboundState.cachedPermission, {
      organizationId: f.owner.team,
      from: f.account,
      contactId: f.contactId,
      now: Date.now(),
    })
  expect(await cached()).toMatchObject({ status: "temporary", can_call: true })
  await f.project(
    reply("wamid.denial", Math.floor(Date.now() / 1000) + 1, "reject"),
    "messages"
  )
  expect(await cached()).toMatchObject({ status: "denied", can_call: false })
})

test("managed IVR calls preserve their route override, record successive attempts and report rejection/no answer", async () => {
  const f = await botRouteFixture()
  const ivr = await (
    await f.request("/ivrs", "POST", {
      name: "Lead follow-up",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "tts", text: "Press one to book" },
          options: { "1": { kind: "hangup" } },
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
        },
      ],
    })
  ).json()
  let attempt = 0
  f.graph.use({
    path: `/${PHONE_ID}/calls`,
    respond: (call) =>
      (call.body as { action: string }).action === "connect"
        ? { calls: [{ id: `wacid.ivr-${++attempt}` }] }
        : { success: true },
  })
  const input = { from: f.account, to: f.contactId, route: `ivr:${ivr.id}` }
  const first = await (await f.request("/whatsapp/calls", "POST", input)).json()
  await f.project({
    metadata: { phone_number_id: PHONE_ID },
    calls: [
      {
        id: "wacid.ivr-1",
        direction: "BUSINESS_INITIATED",
        to: "919999000011",
        event: "terminate",
        status: "FAILED",
        duration: 0,
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
    ],
  })
  expect(
    await (await f.request(`/whatsapp/calls/${first.id}`)).json()
  ).toMatchObject({ outcome: "no_answer", attempt: 1 })
  const second = await (
    await f.request("/whatsapp/calls", "POST", input)
  ).json()
  await f.project({
    metadata: { phone_number_id: PHONE_ID },
    calls: [
      {
        id: "wacid.ivr-2",
        direction: "BUSINESS_INITIATED",
        to: "919999000011",
        event: "connect",
        session: { sdp_type: "answer", sdp: SDP },
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
    ],
  })
  await f.t.action(internal.calling.callActions.gatewayConnect, {
    id: second.id,
  })
  expect(f.routes.at(-1)).toMatchObject({ target: "ivr", ivrId: ivr.id })
  expect(
    await (await f.request(`/whatsapp/calls/${second.id}`)).json()
  ).toMatchObject({ outcome: "answered", attempt: 2, route: `ivr:${ivr.id}` })
  const third = await (await f.request("/whatsapp/calls", "POST", input)).json()
  await f.project({
    metadata: { phone_number_id: PHONE_ID },
    statuses: [
      {
        id: "wacid.ivr-3",
        type: "call",
        direction: "BUSINESS_INITIATED",
        to: "919999000011",
        status: "REJECTED",
        timestamp: String(Math.floor(Date.now() / 1000)),
      },
    ],
  })

  expect(
    await (await f.request(`/whatsapp/calls/${third.id}`)).json()
  ).toMatchObject({ outcome: "rejected", attempt: 3 })
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  expect(events.map((e) => e.type)).toContain("call.outbound_missed")
  expect(events.map((e) => e.type)).toContain("call.outbound_rejected")
})
