// @vitest-environment node
import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { inboundFixture, fakeGraph, PHONE_ID } from "./testHelpers/meta.fixture"
import { patchRow } from "./counts"
import { upsertContact } from "./audience"
import { upsertChannelThread } from "./channels/identity"
import { CALLER_CONTEXT_NOTE_CHARS } from "../lib/voice-caller-context"
import { signRequest } from "../services/call-gateway/src/auth"
import type { Id } from "./_generated/dataModel"
const secret = "a".repeat(64)
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "voice-test-key-".repeat(6))
  vi.stubEnv("CALL_GATEWAY_SECRET", secret)
  vi.stubEnv("CALL_GATEWAY_URL", "http://gateway.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function fixture() {
  const f = await inboundFixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  const key = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Voice", permission: "full_access", domainId: null },
  })
  const request = (path: string, method = "GET", body?: unknown) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        authorization: `Bearer ${key.token}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
  const signed = (
    path: string,
    data: Record<string, unknown>,
    nonce?: string
  ) => {
    const body = JSON.stringify({ version: 1, ...data })
    return f.t.fetch(`/calling/gateway/voice/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signRequest(
          secret,
          "POST",
          `/calling/gateway/voice/${path}`,
          body,
          Math.floor(Date.now() / 1000).toString(),
          nonce
        ),
      },
      body,
    })
  }
  const credentialResponse = await request("/voice-providers", "POST", {
    provider: "gemini",
    label: "Primary",
    key: "secret-provider-key-1234",
  })
  expect(credentialResponse.status).toBe(200)
  const credential = (await credentialResponse.json())
    .id as Id<"voiceProviders">
  const created = await request("/voice-bots", "POST", {
    name: "Support",
    provider: "gemini",
    credentialId: credential,
    tools: [
      "lookup_contact",
      "create_note",
      "send_whatsapp_message",
      "transfer_to_agent",
      "transfer_to_ivr",
      "end_call",
    ],
    maxConcurrentCalls: 1,
    monthlyMinuteBudget: 10,
  })
  expect(created.status).toBe(200)
  const bot = (await created.json()).id as Id<"voiceBots">
  await f.t.run((ctx) =>
    ctx.db.insert("callingSettings", {
      organizationId: f.owner.team,
      accountId: f.account,
      mode: "gateway",
      settings: "{}",
      routing: { kind: "bot", botId: bot },
      updatedAt: Date.now(),
    })
  )
  const createCall = () =>
    f.t.run((ctx) =>
      ctx.db.insert("calls", {
        organizationId: f.owner.team,
        accountId: f.account,
        direction: "inbound",
        status: "connected",
        mode: "gateway",
        userId: "US.caller",
        observedAt: Date.now(),
        connectedAt: Date.now(),
      })
    )
  return { ...f, request, signed, credential, bot, createCall }
}
async function attachCaller(
  f: Awaited<ReturnType<typeof fixture>>,
  callId: Id<"calls">,
  firstName = "Ada"
) {
  return f.t.run(async (ctx) => {
    const contact = await upsertContact(
      ctx,
      f.owner.team,
      { phone: "+15555550123", firstName },
      { properties: [], segmentIds: [], skipExisting: true }
    )
    await ctx.db.patch("calls", callId, {
      contactId: contact.id,
      from: "15555550123",
    })
    return contact.id
  })
}
async function botSession(
  f: Awaited<ReturnType<typeof fixture>>,
  callId: Id<"calls">
) {
  const response = await f.signed("session", {
    callId,
    organizationId: f.owner.team,
  })
  expect(response.status).toBe(200)
  return (await response.json()) as {
    callerContextBlock?: string
    keys: { live?: string }
    systemPrompt: string
  }
}
async function ivrGateway(
  f: Awaited<ReturnType<typeof fixture>>,
  path: string,
  data: Record<string, unknown>
) {
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
test("credentials are write-only in REST, queries, logs and errors; authenticated session is the only decrypted channel", async () => {
  const f = await fixture()
  const providers = await (await f.request("/voice-providers")).json()
  expect(providers.data[0]).toMatchObject({ lastFour: "1234" })
  expect(JSON.stringify(providers)).not.toContain("secret-provider")
  const bot = await (await f.request(`/voice-bots/${f.bot}`)).json()
  expect(bot.credentialId).toBe(f.credential)
  expect(JSON.stringify(bot)).not.toContain("secret-provider")
  const logs = await f.t.run((ctx) => ctx.db.query("apiLogBodies").take(100))
  expect(JSON.stringify(logs)).not.toContain("secret-provider")
  const callId = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: callId })).target
  ).toBe("bot")
  const session = await f.signed("session", {
    callId,
    organizationId: f.owner.team,
  })
  expect(session.status).toBe(200)
  expect((await session.json()).keys.live).toBe("secret-provider-key-1234")
  expect(session.headers.get("cache-control")).toBe("no-store")
  expect(
    (await f.signed("session", { callId, organizationId: "other-team" })).status
  ).toBe(404)
  const body = JSON.stringify({
    version: 1,
    callId,
    organizationId: f.owner.team,
  })
  expect(
    (
      await f.t.fetch("/calling/gateway/voice/session", {
        method: "POST",
        body,
      })
    ).status
  ).toBe(401)
  expect(
    (await f.request(`/voice-providers/${f.credential}`, "DELETE")).status
  ).toBe(409)
})
test("atomic admission falls back for concurrency and monthly reservations; completion frees capacity with bounded duration", async () => {
  const f = await fixture(),
    one = await f.createCall(),
    two = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: one })).target
  ).toBe("bot")
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: one })).target
  ).toBe("bot")
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: two })).target
  ).toBe("voicemail")
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", two)))!.botFallbackReason
  ).toBe("concurrency_exhausted")
  vi.setSystemTime(Date.now() + 60000)
  const completed = await f.signed("events", {
    callId: one,
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    type: "bot_completed",
    outcome: "completed",
    summary: "Asked about an order",
    usage: { inputTokens: 12 },
  })
  expect(completed.status).toBe(200)
  const row = await f.t.run((ctx) => ctx.db.get("calls", one))
  expect(row).toMatchObject({
    botActive: false,
    botDuration: 60,
    botOutcome: "completed",
  })
  const three = await f.createCall()
  expect(
    (await f.t.mutation(internal.voice.routing.select, { id: three })).target
  ).toBe("voicemail")
  expect(
    (await f.t.run((ctx) => ctx.db.get("calls", three)))!.botFallbackReason
  ).toBe("budget_exhausted")
  const events = await f.t.run((ctx) =>
    ctx.db
      .query("events")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", f.owner.team)
      )
      .take(100)
  )
  expect(JSON.stringify(events)).not.toContain("secret-provider")
})
test("tool catalog rejects tenant/recipient overrides, durably deduplicates notes, denies IVR, and transcript cursors are scoped", async () => {
  const f = await fixture(),
    callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const tool = (
    id: string,
    name: string,
    args: Record<string, unknown>,
    organizationId = f.owner.team
  ) =>
    f.signed("tools", {
      callId,
      organizationId,
      toolCall: { id, name, arguments: args },
    })
  expect(
    (await tool("lookup", "lookup_contact", { contactId: "other" })).status
  ).toBe(200)
  expect(
    await (
      await tool("lookup", "lookup_contact", { contactId: "other" })
    ).json()
  ).toMatchObject({ ok: false })
  expect((await tool("cross", "lookup_contact", {}, "other-team")).status).toBe(
    404
  )
  const note = await (
    await tool("note", "create_note", { text: "Caller needs support" })
  ).json()
  expect(note).toMatchObject({
    ok: true,
    result: { storedOn: "contact", noteId: expect.any(String) },
  })
  expect(
    await (
      await tool("note", "create_note", { text: "Caller needs support" })
    ).json()
  ).toEqual(note)
  const storedNotes = await f.t.run((ctx) =>
    ctx.db.query("contactNotes").collect()
  )
  expect(storedNotes).toHaveLength(1)
  expect(storedNotes[0]).toMatchObject({
    _id: note.result.noteId,
    body: "Caller needs support",
    organizationId: f.owner.team,
    author: { kind: "bot", id: f.bot, name: "Support" },
    source: { callId },
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("contacts", storedNotes[0].contactId))
  ).toMatchObject({ organizationId: f.owner.team })
  expect(
    await (await tool("note", "create_note", { text: "different" })).json()
  ).toMatchObject({ ok: false })
  expect(await (await tool("ivr", "transfer_to_ivr", {})).json()).toMatchObject(
    { ok: false, error: "IVR handoff disabled" }
  )
  expect(
    await (
      await tool("send", "send_whatsapp_message", {
        text: "Hello",
        recipient: "someone-else",
      })
    ).json()
  ).toMatchObject({ ok: false })
  const nonce = crypto.randomUUID()
  expect(
    (
      await f.signed(
        "tools",
        {
          callId,
          organizationId: f.owner.team,
          toolCall: { id: "replay", name: "lookup_contact", arguments: {} },
        },
        nonce
      )
    ).status
  ).toBe(200)
  expect(
    (
      await f.signed(
        "tools",
        {
          callId,
          organizationId: f.owner.team,
          toolCall: { id: "replay", name: "lookup_contact", arguments: {} },
        },
        nonce
      )
    ).status
  ).toBe(401)
  const notes = await f.t.run((ctx) =>
    ctx.db
      .query("callTranscripts")
      .withIndex("by_callId", (q) => q.eq("callId", callId))
      .take(100)
  )
  expect(notes.filter((n) => n.kind === "note")).toHaveLength(1)
  const page = await (
    await f.request(`/whatsapp/calls/${callId}/transcript?limit=1`)
  ).json()
  expect(page.data).toHaveLength(1)
  expect(page.has_more).toBe(true)
  const second = await (
    await f.request(
      `/whatsapp/calls/${callId}/transcript?limit=1&after=${page.data[0].id}`
    )
  ).json()
  expect(second.data[0].id).not.toBe(page.data[0].id)
  const otherCall = await f.createCall(),
    otherLine = await f.t.run((ctx) =>
      ctx.db.insert("callTranscripts", {
        organizationId: f.owner.team,
        callId: otherCall,
        eventId: crypto.randomUUID(),
        kind: "note",
        text: "Other call",
        timestampMs: 0,
      })
    )
  expect(
    (await f.request(`/whatsapp/calls/${callId}/transcript?after=${otherLine}`))
      .status
  ).toBe(422)
  const eventId = crypto.randomUUID(),
    event = {
      callId,
      eventId,
      timestamp: Date.now(),
      type: "transcript",
      transcript: {
        role: "caller",
        text: "hello",
        final: true,
        timestampMs: 100,
      },
    }
  expect((await f.signed("events", event)).status).toBe(200)
  expect((await f.signed("events", event)).status).toBe(200)
  const stored = await f.t.run((ctx) =>
    ctx.db
      .query("callTranscripts")
      .withIndex("by_callId_and_eventId", (q) =>
        q.eq("callId", callId).eq("eventId", eventId)
      )
      .take(2)
  )
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({
    timeline: "call",
    timestampMs: 100,
    text: "hello",
  })
  await f.t.run((ctx) => ctx.db.patch("calls", callId, { status: "completed" }))
  expect((await tool("late", "end_call", {})).status).toBe(404)
})
test("voice resource scopes, same-provider credential ownership, config validation and number routing", async () => {
  const f = await fixture()
  const custom = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: {
      name: "WhatsApp",
      permission: "custom",
      scopes: ["whatsapp:write"],
      domainId: null,
    },
  })
  vi.setSystemTime(Date.now() + 1100)
  expect(
    (
      await f.t.fetch("/voice-bots", {
        headers: { authorization: `Bearer ${custom.token}` },
      })
    ).status
  ).toBe(403)
  expect(
    (
      await f.request(`/voice-bots/${f.bot}`, "PATCH", {
        language: "unsupported",
      })
    ).status
  ).toBe(422)
  expect((await f.request(`/voice-bots/${f.bot}`, "DELETE")).status).toBe(409)
  expect(
    (
      await f.request("/voice-bots", "POST", {
        name: "Other provider",
        credentialId: f.credential,
        provider: "sarvam",
      })
    ).status
  ).toBe(422)
  const foreign = await f.t.run((ctx) =>
    ctx.db.insert("voiceProviders", {
      organizationId: "other-team",
      provider: "gemini",
      label: "Private",
      encryptedKey: "not-a-key",
      lastFour: "1234",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  expect(
    (
      await f.request("/voice-bots", "POST", {
        name: "Cross-team",
        credentialId: foreign,
        provider: "gemini",
      })
    ).status
  ).toBe(422)
})

test("hangup events revoke tool access before summaries finish, and non-bot voice events remain supported", async () => {
  const f = await fixture(),
    callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  expect(
    (
      await f.signed("events", {
        callId,
        type: "state",
        state: "hangup",
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  expect(
    (
      await f.signed("tools", {
        callId,
        organizationId: f.owner.team,
        toolCall: { id: "after-stop", name: "end_call", arguments: {} },
      })
    ).status
  ).toBe(404)
  expect(
    (
      await f.signed("events", {
        callId,
        type: "bot_completed",
        outcome: "caller_hangup",
        summary: "Caller hung up",
        endedAt: Date.now(),
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  const voicemail = await f.createCall()
  expect(
    (
      await f.signed("events", {
        callId: voicemail,
        type: "state",
        state: "voicemail",
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
      })
    ).status
  ).toBe(200)
  expect(
    (await f.request(`/whatsapp/calls/${voicemail}/transcript`)).status
  ).toBe(200)
})

test("cascade stage credentials are team-scoped, fetched only in the signed session, and protected from deletion", async () => {
  const f = await fixture()
  const sarvam = await (
    await f.request("/voice-providers", "POST", {
      provider: "sarvam",
      label: "STT/LLM",
      key: "fake-sarvam-key",
    })
  ).json()
  const eleven = await (
    await f.request("/voice-providers", "POST", {
      provider: "elevenlabs",
      label: "TTS",
      key: "fake-eleven-key",
    })
  ).json()
  const response = await f.request("/voice-bots", "POST", {
    name: "India",
    engine: "cascade",
    provider: "sarvam",
    credentialId: sarvam.id,
    language: "gu-IN",
    tts: { provider: "elevenlabs", credentialId: eleven.id, voice: "voice-id" },
  })
  expect(response.status).toBe(200)
  const bot = await response.json()
  const read = await (await f.request(`/voice-bots/${bot.id}`)).json()
  expect(read).toMatchObject({
    engine: "cascade",
    stt: { model: "saaras:v4" },
    llm: { model: "sarvam-105b-conversations" },
    tts: { model: "eleven_v4_turbo" },
  })
  expect(JSON.stringify(read)).not.toContain("fake-eleven-key")
  expect(
    (await f.request(`/voice-providers/${eleven.id}`, "DELETE")).status
  ).toBe(409)
  await f.t.run(async (ctx) => {
    const settings = await ctx.db
      .query("callingSettings")
      .withIndex("by_accountId", (q) => q.eq("accountId", f.account))
      .unique()
    await ctx.db.patch("callingSettings", settings!._id, {
      routing: { kind: "bot", botId: bot.id },
    })
  })
  const callId = await f.createCall()
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const session = await (
    await f.signed("session", { callId, organizationId: f.owner.team })
  ).json()
  expect(session.keys).toEqual({
    stt: "fake-sarvam-key",
    llm: "fake-sarvam-key",
    tts: "fake-eleven-key",
  })
  const logBodies = await f.t.run((ctx) =>
    ctx.db.query("apiLogBodies").take(100)
  )
  expect(JSON.stringify(logBodies)).not.toContain("fake-eleven-key")
})

test("end_call authorization and signed gateway hangup terminate the Meta call", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  await f.t.run((ctx) =>
    ctx.db.patch("calls", callId, { wacid: "wacid.bot-end" })
  )
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const tool = await f.signed("tools", {
    callId,
    organizationId: f.owner.team,
    toolCall: { id: "end-1", name: "end_call", arguments: {} },
  })
  expect(await tool.json()).toEqual({
    ok: true,
    result: { action: "end_call" },
  })
  for (const event of [
    {
      type: "tool_call",
      toolId: "end-1",
      toolName: "end_call",
      status: "succeeded",
    },
    { type: "playback_done", turnId: "goodbye", playedMs: 600 },
    { type: "hangup", reason: "Ended by bot" },
  ])
    expect(
      (
        await f.signed("events", {
          callId,
          timestamp: Date.now(),
          eventId: crypto.randomUUID(),
          ...event,
        })
      ).status
    ).toBe(200)
  const graph = fakeGraph([
    {
      path: `/${PHONE_ID}/calls`,
      method: "POST",
      respond: () => ({ success: true }),
    },
  ])
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true }))
  )
  const path = "/calling/gateway/events"
  const body = JSON.stringify({
    version: 1,
    callId,
    eventId: crypto.randomUUID(),
    timestamp: Date.now(),
    event: "hangup",
    reason: "Ended by bot",
  })
  expect(
    (
      await f.t.fetch(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...signRequest(secret, "POST", path, body),
        },
        body,
      })
    ).status
  ).toBe(200)
  await f.t.finishInProgressScheduledFunctions()
  // Run due jobs, including the gatewayHangup action scheduled by the real callback mutation.
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  expect(
    graph.to(`/${PHONE_ID}/calls`, "POST").map((c) => c.body)
  ).toContainEqual({
    messaging_product: "whatsapp",
    action: "terminate",
    call_id: "wacid.bot-end",
  })
  const row = await f.t.run((ctx) => ctx.db.get("calls", callId))
  expect(row?.status).toBe("completed")
  const lines = await f.t.run((ctx) =>
    ctx.db
      .query("callTranscripts")
      .withIndex("by_callId_and_eventId", (q) => q.eq("callId", callId))
      .collect()
  )
  expect(lines.some((l) => l.toolName === "end_call")).toBe(true)
  expect(lines.some((l) => l.text?.includes("Ended by bot"))).toBe(true)
})
test.each([true, false])(
  "voice tools resolve linked and legacy BSUID callers: linked=%s",
  async (linked) => {
    const f = await fixture()
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
        at: Date.now(),
        direction: "inbound",
        preview: "Prior message",
      })
      await ctx.db.patch("channelContacts", links.channelContactId, {
        userId: "US.caller",
        contactId: contact.id,
      })
      return { ...links, contactId: contact.id }
    })
    const callId = await f.createCall()
    await f.t.run((ctx) =>
      ctx.db.patch("calls", callId, {
        from: "US.caller",
        ...(linked ? links : {}),
      })
    )
    await f.t.mutation(internal.voice.routing.select, { id: callId })
    const tool = (id: string, name: string, args: Record<string, unknown>) =>
      f.signed("tools", {
        callId,
        organizationId: f.owner.team,
        toolCall: { id, name, arguments: args },
      })
    expect(
      await (await tool("lookup-kamal", "lookup_contact", {})).json()
    ).toMatchObject({ ok: true, result: { name: "Kamal" } })
    expect(
      await (
        await tool("note-kamal", "create_note", { text: "Follow up tomorrow" })
      ).json()
    ).toMatchObject({
      ok: true,
      result: { storedOn: "contact", noteId: expect.any(String) },
    })
    expect(await f.t.run((ctx) => ctx.db.get("calls", callId))).toMatchObject(
      links
    )
    const sent = await (
      await tool("send-kamal", "send_whatsapp_message", {
        text: "Thanks for calling",
      })
    ).json()
    expect(sent).toMatchObject({ ok: true, result: { id: expect.any(String) } })
    const message = (await f.t.run((ctx) =>
      ctx.db.query("channelMessages").first()
    ))!
    expect(message).toMatchObject({
      channelContactId: links.channelContactId,
      conversationId: links.conversationId,
      to: "US.caller",
    })
    const content = (await f.t.run((ctx) =>
      ctx.db.query("channelMessageContents").first()
    ))!
    expect(JSON.parse(content.payload)).toMatchObject({
      recipient: "US.caller",
    })
    expect(JSON.parse(content.payload).to).toBeUndefined()
    expect(
      await f.t.run((ctx) => ctx.db.query("channelContacts").collect())
    ).toHaveLength(1)
  }
)

test("lookup_contact returns caller properties, segments, identities and readable recent messages", async () => {
  const f = await fixture()
  const now = Date.now()
  const linked = await f.t.run(async (ctx) => {
    const contact = await upsertContact(
      ctx,
      f.owner.team,
      {
        phone: "+919316108172",
        firstName: "Kamal",
        properties: { plan: "Pro" },
      },
      {
        properties: [{ key: "plan", type: "string" }],
        segmentIds: [],
        skipExisting: true,
      }
    )
    const account = (await ctx.db.get("channelAccounts", f.account))!
    const thread = await upsertChannelThread(ctx, account, {
      externalId: "919316108172",
      phone: "+919316108172",
      at: now,
      direction: "inbound",
      preview: "Prior message",
    })
    await ctx.db.patch("channelContacts", thread.channelContactId, {
      contactId: contact.id,
      userId: "US.caller",
    })
    const segmentId = await ctx.db.insert("segments", {
      organizationId: f.owner.team,
      name: "VIP",
    })
    await ctx.db.insert("segmentMembers", {
      organizationId: f.owner.team,
      segmentId,
      contactId: contact.id,
    })
    for (const [type, direction, payload, rendered] of [
      [
        "interactive",
        "inbound",
        {
          interactive: {
            type: "button_reply",
            button_reply: { title: "Yes please" },
          },
        },
        undefined,
      ],
      [
        "interactive",
        "outbound",
        {
          interactive: {
            type: "button",
            body: { text: "Would you like help?" },
          },
        },
        undefined,
      ],
      ["image", "inbound", { image: { caption: "My receipt" } }, undefined],
      [
        "template",
        "outbound",
        { template: { name: "welcome" } },
        { body: "Welcome Kamal", buttons: [] },
      ],
    ] as const) {
      const messageId = await ctx.db.insert("channelMessages", {
        organizationId: f.owner.team,
        accountId: f.account,
        channelContactId: thread.channelContactId,
        conversationId: thread.conversationId,
        channel: "whatsapp",
        direction,
        type,
        status: direction === "inbound" ? "received" : "sent",
        from: "919316108172",
        to: "business",
        preview: `[${type}]`,
        generation: 0,
        attempts: 0,
        observedAt: now - 2 * 3600_000,
      })
      await ctx.db.insert("channelMessageContents", {
        messageId,
        payload: JSON.stringify({ type, ...payload }),
        ...(rendered ? { rendered: { body: rendered.body, buttons: [] } } : {}),
      })
    }
    return { ...thread, contactId: contact.id }
  })
  const callId = await f.createCall()
  await f.t.run((ctx) => ctx.db.patch("calls", callId, linked))
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const response = await f.signed("tools", {
    callId,
    organizationId: f.owner.team,
    toolCall: { id: "readable-1", name: "lookup_contact", arguments: {} },
  })
  const { result } = await response.json()
  expect(result).toMatchObject({
    name: "Kamal",
    phone: "+919316108172",
    properties: { plan: "Pro" },
    tags: ["VIP"],
    channelIdentities: [
      { channel: "whatsapp", userId: "US.caller", phone: "+919316108172" },
    ],
  })
  for (const line of [
    "Customer (2h ago): Yes please",
    "Business (2h ago): Would you like help?",
    "Customer (2h ago): Image: My receipt",
    "Business (2h ago): Welcome Kamal",
  ])
    expect(result.recentMessageSummary).toContain(line)
  expect(result.recentMessageSummary).not.toContain("[interactive]")
})

test("caller lookup defaults on for new and old bots, and names an unknown caller", async () => {
  const f = await fixture()
  expect(
    (await (await f.request(`/voice-bots/${f.bot}`)).json()).callerContext
  ).toBe(true)
  await f.t.run(async (ctx) => {
    const bot = (await ctx.db.get("voiceBots", f.bot))!
    const { _id, _creationTime, callerContext: _callerContext, ...rest } = bot
    void _creationTime
    void _callerContext
    await ctx.db.replace("voiceBots", _id, rest)
  })
  expect(
    (await (await f.request(`/voice-bots/${f.bot}`)).json()).callerContext
  ).toBe(true)
  const callId = await f.createCall()
  await f.t.run((ctx) =>
    ctx.db.patch("calls", callId, { from: "15555550124" })
  )
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const body = await botSession(f, callId)
  expect(body.callerContextBlock).toBe(
    "Caller context (from the CRM; do not read it out unless relevant): Caller not found in CRM; phone +15555550124"
  )
  expect(body.callerContextBlock).not.toMatch(/name:/)
  expect(body.keys.live).toBe("secret-provider-key-1234")
})

test("a bot session includes the same caller record as lookup_contact, capped for the prompt", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  await attachCaller(f, callId)
  await f.t.run(async (ctx) => {
    const call = (await ctx.db.get("calls", callId))!
    await ctx.db.patch("contacts", call.contactId!, {
      properties: { note: "n".repeat(4000) },
    })
  })
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const body = await botSession(f, callId)
  expect(body.callerContextBlock).toContain(
    "Caller context (from the CRM; do not read it out unless relevant):"
  )
  expect(body.callerContextBlock).toContain("name: Ada")
  expect(body.callerContextBlock).toContain("phone: +15555550123")
  expect(body.callerContextBlock!.length).toBeLessThanOrEqual(2000)
  expect(body.callerContextBlock).not.toContain("n".repeat(4000))
  const tool = await (
    await f.signed("tools", {
      callId,
      organizationId: f.owner.team,
      toolCall: { id: "lookup-ada", name: "lookup_contact", arguments: {} },
    })
  ).json()
  expect(tool).toMatchObject({
    ok: true,
    result: { name: "Ada", phone: "+15555550123" },
  })
  expect(tool.result.found).toBeUndefined()
  expect(tool.result.properties.note).toHaveLength(4000)
})

test("a bot session includes the caller's newest contact notes, each truncated", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  const contactId = await attachCaller(f, callId)
  const otherId = await f.t.run(async (ctx) => {
    const contact = await upsertContact(
      ctx,
      f.owner.team,
      { phone: "+15555550199", firstName: "Other" },
      { properties: [], segmentIds: [], skipExisting: true }
    )
    return contact.id
  })
  const newest = `newest ${"n".repeat(CALLER_CONTEXT_NOTE_CHARS)}`
  for (const body of [
    "oldest note",
    "second note",
    "third note",
    "fourth note",
    "Fifth\nline",
    newest,
  ]) {
    vi.setSystemTime(Date.now() + 1000)
    await f.t.run((ctx) =>
      ctx.db.insert("contactNotes", {
        organizationId: f.owner.team,
        contactId,
        body,
        author: { kind: "user", id: "user-1" },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
  }
  vi.setSystemTime(Date.now() + 1000)
  await f.t.run((ctx) =>
    ctx.db.insert("contactNotes", {
      organizationId: f.owner.team,
      contactId: otherId,
      body: "other caller secret",
      author: { kind: "user", id: "user-2" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const body = await botSession(f, callId)
  const shown = newest.slice(0, CALLER_CONTEXT_NOTE_CHARS)
  const block = body.callerContextBlock ?? ""
  expect(block).toContain("name: Ada")
  expect(block).toContain(
    `notes:\n- ${shown}\n- Fifth line\n- fourth note\n- third note\n- second note`
  )
  expect(block).not.toContain("oldest note")
  expect(block).not.toContain("other caller secret")
  expect(block).not.toContain(newest)
  expect(block.length).toBeLessThanOrEqual(2000)
  const tool = await (
    await f.signed("tools", {
      callId,
      organizationId: f.owner.team,
      toolCall: { id: "lookup-notes", name: "lookup_contact", arguments: {} },
    })
  ).json()
  expect(tool.result.notes).toEqual([
    shown,
    "Fifth line",
    "fourth note",
    "third note",
    "second note",
  ])
})

test("caller lookup can be turned off", async () => {
  const f = await fixture()
  expect(
    (
      await f.request(`/voice-bots/${f.bot}`, "PATCH", { callerContext: false })
    ).status
  ).toBe(200)
  expect(
    (await (await f.request(`/voice-bots/${f.bot}`)).json()).callerContext
  ).toBe(false)
  const callId = await f.createCall()
  await attachCaller(f, callId)
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  const body = await botSession(f, callId)
  expect(body.callerContextBlock).toBeUndefined()
  expect(body.keys.live).toBe("secret-provider-key-1234")
  expect(
    errors.mock.calls.some((call) =>
      String(call[0]).includes("caller context unavailable")
    )
  ).toBe(false)
})

test("a failed caller lookup still starts the bot without the block", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  await f.t.run(async (ctx) => {
    const contact = await upsertContact(
      ctx,
      f.owner.team,
      { phone: "+15555550123", firstName: "Ada" },
      { properties: [], segmentIds: [], skipExisting: true }
    )
    const account = (await ctx.db.get("channelAccounts", f.account))!
    const thread = await upsertChannelThread(ctx, account, {
      externalId: "15555550123",
      phone: "+15555550123",
      at: Date.now(),
      direction: "inbound",
      preview: "Hello",
    })
    const messageId = await ctx.db.insert("channelMessages", {
      organizationId: f.owner.team,
      accountId: f.account,
      channelContactId: thread.channelContactId,
      conversationId: thread.conversationId,
      channel: "whatsapp",
      direction: "inbound",
      type: "text",
      status: "received",
      from: "15555550123",
      to: "business",
      preview: "Hello",
      generation: 0,
      attempts: 0,
      observedAt: Date.now(),
    })
    await ctx.db.insert("channelMessageContents", {
      messageId,
      payload: "not-json",
    })
    await ctx.db.patch("calls", callId, {
      contactId: contact.id,
      channelContactId: thread.channelContactId,
      conversationId: thread.conversationId,
      from: "15555550123",
    })
  })
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const errors = vi.spyOn(console, "error").mockImplementation(() => {})
  const body = await botSession(f, callId)
  expect(body.keys.live).toBe("secret-provider-key-1234")
  expect(body.callerContextBlock).toBeUndefined()
  expect(
    errors.mock.calls.some((call) =>
      String(call[0]).includes("caller context unavailable") &&
      String(call[0]).includes("reason=failed")
    )
  ).toBe(true)
  expect(errors.mock.calls.some((call) => String(call[0]).includes("Ada"))).toBe(
    false
  )
  expect(
    await (
      await f.signed("tools", {
        callId,
        organizationId: f.owner.team,
        toolCall: { id: "lookup-broken", name: "lookup_contact", arguments: {} },
      })
    ).json()
  ).toMatchObject({ ok: false })
})

test("the next bot session after an IVR transfer loads the caller again", async () => {
  const f = await fixture()
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
  const created = await f.request(
    "/ivrs",
    "POST",
    {
      name: "Reception",
      language: "en",
      entryMenuId: "main",
      menus: [
        {
          id: "main",
          name: "Main",
          prompt: { kind: "audio", fileId: upload },
          options: { "1": { kind: "bot", botId: f.bot } },
          noInputAction: { kind: "hangup" },
          failureAction: { kind: "hangup" },
        },
      ],
    }
  )
  expect(created.status).toBe(201)
  const ivr = (await created.json()).id as string
  expect(
    (
      await f.request(`/voice-bots/${f.bot}`, "PATCH", {
        handoff: { agents: true, ivrId: ivr },
      })
    ).status
  ).toBe(200)
  // The fixture budget equals one max session, so a second bot admission would
  // otherwise fall through to voicemail.
  await f.t.run((ctx) =>
    ctx.db.patch("voiceBots", f.bot, { monthlyMinuteBudget: 100000 })
  )
  const callId = await f.createCall()
  const contactId = await attachCaller(f, callId)
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const first = await botSession(f, callId)
  expect(first.callerContextBlock).toContain("name: Ada")
  await f.t.run((ctx) =>
    ctx.db.patch("contacts", contactId, { firstName: "Nia" })
  )
  expect(
    await (
      await f.signed("tools", {
        callId,
        organizationId: f.owner.team,
        toolCall: { id: "to-ivr", name: "transfer_to_ivr", arguments: {} },
      })
    ).json()
  ).toMatchObject({ ok: true, result: { action: "transfer_to_ivr", ivrId: ivr } })
  vi.setSystemTime(Date.now() + 2000)
  expect(
    (
      await f.signed("events", {
        callId,
        eventId: crypto.randomUUID(),
        timestamp: Date.now(),
        type: "bot_completed",
        outcome: "transferred_ivr",
        summary: "Returning to the menu",
        usage: { inputTokens: 1 },
      })
    ).status
  ).toBe(200)
  expect(
    (
      await ivrGateway(f, "/calling/gateway/ivr/start", { callId, ivrId: ivr })
    ).status
  ).toBe(200)
  const next = await ivrGateway(f, "/calling/gateway/ivr/next", {
    callId,
    ivrId: ivr,
    menuId: "main",
    digits: "1",
    step: 0,
  })
  expect(next.status).toBe(200)
  expect(await next.json()).toMatchObject({
    action: { kind: "bot", botId: f.bot },
  })
  const second = await botSession(f, callId)
  expect(second.callerContextBlock).toContain("name: Nia")
  expect(second.callerContextBlock).not.toContain("name: Ada")
  expect(second.keys.live).toBe("secret-provider-key-1234")
})

test("create_note falls back to the call record when caller identity is unavailable", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  await f.t.run((ctx) => ctx.db.patch("calls", callId, { userId: undefined }))
  await f.t.mutation(internal.voice.routing.select, { id: callId })
  const result = await (
    await f.signed("tools", {
      callId,
      organizationId: f.owner.team,
      toolCall: {
        id: "fallback-note",
        name: "create_note",
        arguments: { text: "Call only" },
      },
    })
  ).json()
  expect(result).toMatchObject({ ok: true, result: { storedOn: "call" } })
  expect(
    await f.t.run((ctx) => ctx.db.query("contactNotes").collect())
  ).toEqual([])
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("callTranscripts")
        .filter((q) => q.eq(q.field("kind"), "note"))
        .first()
    )
  ).toMatchObject({ callId, text: "Call only" })
})

test("REST contact note sources are scoped and preserved across edits", async () => {
  const f = await fixture()
  const callId = await f.createCall()
  const contact = await f.owner.client.mutation(api.contacts.upsert, {
    organizationId: f.owner.team,
    contacts: [{ phone: "+14155550100" }],
    segmentIds: [],
  })
  const path = `/contacts/${contact.createdIds[0]}/notes`
  const response = await f.request(path, "POST", {
    body: "Call context",
    source: { call_id: callId },
  })
  expect(response.status).toBe(201)
  const note = await response.json()
  expect(note.source).toEqual({ call_id: callId })
  const edit = await f.request(`${path}/${note.id}`, "PATCH", {
    body: "Edited",
    source: {},
  })
  expect(edit.status).toBe(200)
  expect((await edit.json()).source).toEqual(note.source)
  const foreignCall = await f.t.run((ctx) =>
    ctx.db.insert("calls", {
      organizationId: f.outsider.team,
      accountId: f.account,
      direction: "inbound",
      status: "connected",
      mode: "gateway",
      observedAt: Date.now(),
    })
  )
  expect(
    (
      await f.request(path, "POST", {
        body: "Foreign",
        source: { call_id: foreignCall },
      })
    ).status
  ).toBe(422)
  expect(
    (
      await f.request(path, "POST", {
        body: "Malformed",
        source: { call_id: "invalid-id" },
      })
    ).status
  ).toBe(422)
  expect(
    (
      await f.request(path, "POST", {
        body: "Malformed",
        source: "not-an-object",
      })
    ).status
  ).toBe(422)
  expect(
    await f.t.run((ctx) => ctx.db.query("contactNotes").collect())
  ).toHaveLength(1)
})
