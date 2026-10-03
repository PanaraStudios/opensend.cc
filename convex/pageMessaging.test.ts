import { beforeEach, afterEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { decryptSecret } from "./secrets"
import {
  fakeGraph,
  graphError,
  signedWebhook,
  APP_SECRET,
  metaFixture,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PAGE,
  PAGE_ID,
  IG_ID,
  PSID,
  IGSID,
  PAGE_TOKEN,
  USER_TOKEN,
} from "./testHelpers/pages.fixture"
import type { Id } from "./_generated/dataModel"

let graph: ReturnType<typeof fakeGraph>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "page-test-secret-".repeat(4))
  vi.stubEnv("BETTER_AUTH_SECRET", "page-test-downloads")
  graph = fakeGraph(pageGraphRoutes())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
async function project(
  f: Awaited<ReturnType<typeof metaFixture>>,
  payload: unknown
) {
  const res = await f.t.fetch(
    "/meta/webhook",
    await signedWebhook(APP_SECRET, payload)
  )
  expect(res.status).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  return event!._id
}
async function setup(open = true) {
  const f = await pagesFixture()
  if (open)
    for (const channel of ["messenger", "instagram"] as const)
      await project(
        f,
        pageEnvelope(channel, {
          message: { mid: `mid.${channel}`, text: "Hello" },
        })
      )
  const { token } = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Pages", permission: "full_access", domainId: null },
  })
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
    bearer = token
  ) => {
    vi.setSystemTime(Date.now() + 1100)
    return f.t.fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const message = (id: Id<"channelMessages">) =>
    f.t.run((ctx) => ctx.db.get("channelMessages", id))
  const send = async (
    channel = "messenger",
    body: Record<string, unknown> = {}
  ) => {
    const result = await call(`/${channel}/messages`, "POST", {
      to: channel === "messenger" ? PSID : IGSID,
      text: "Reply",
      ...body,
    })
    expect(result.status, await result.clone().text()).toBe(200)
    return (await result.json()).id as Id<"channelMessages">
  }
  return { ...f, token, call, message, send }
}

test("Facebook Login exchanges, debugs, lists Pages, subscribes with the Page token and stores encrypted Page/IG accounts", async () => {
  const f = await metaFixture()
  const result = await f.member.client.action(
    api.meta.pageConnectActions.connectFacebookLogin,
    { organizationId: f.owner.team, code: "login-code" }
  )
  expect(result.accounts.map((a) => a.channel)).toEqual([
    "messenger",
    "instagram",
  ])
  expect(graph.calls.map((c) => c.path)).toEqual([
    "/oauth/access_token",
    "/debug_token",
    "/me/accounts",
    `/${PAGE_ID}/subscribed_apps`,
  ])
  expect(graph.to("/me/accounts")[0]).toMatchObject({
    authorization: `Bearer ${USER_TOKEN}`,
    query: {
      fields:
        "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
    },
  })
  expect(graph.to(`/${PAGE_ID}/subscribed_apps`)[0]).toMatchObject({
    authorization: `Bearer ${PAGE_TOKEN}`,
    body: {
      subscribed_fields:
        "messages,message_deliveries,message_reads,messaging_postbacks,message_echoes",
    },
  })
  const list = await f.owner.client.query(api.meta.connect.listAccounts, {
    organizationId: f.owner.team,
    paginationOpts: { cursor: null, numItems: 10 },
  })
  expect(list.page.map((a) => a.externalId).sort()).toEqual(
    [IG_ID, PAGE_ID].sort()
  )
  expect(list.page.every((a) => !("encryptedToken" in a))).toBe(true)
  for (const row of result.accounts) {
    const stored = await f.t.run((ctx) => ctx.db.get("channelAccounts", row.id))
    expect(stored!.encryptedToken).toBeUndefined()
    const connection = await f.t.run((ctx) =>
      ctx.db.get("metaConnections", stored!.connectionId)
    )
    expect(await decryptSecret(connection!.encryptedToken)).toBe(PAGE_TOKEN)
    const detail = await f.owner.client.query(api.meta.connect.getAccount, {
      id: row.id,
    })
    expect(detail?.account.pageId).toBe(PAGE_ID)
    expect(detail?.connection).toMatchObject({
      method: "facebook_login",
      tokenLast4: PAGE_TOKEN.slice(-4),
    })
  }
})
test("manual connect reuses rows; another team is refused before subscribing, and unauthorized callers cannot connect", async () => {
  const f = await pagesFixture()
  const reconnect = await f.owner.client.action(
    api.meta.pageConnectActions.connectPageManual,
    { organizationId: f.owner.team, pageId: PAGE_ID, token: PAGE_TOKEN }
  )
  expect(reconnect.accounts).toEqual(f.accounts)
  graph.calls.length = 0
  await expect(
    f.outsider.client.action(api.meta.pageConnectActions.connectPageManual, {
      organizationId: f.outsider.team,
      pageId: PAGE_ID,
      token: PAGE_TOKEN,
    })
  ).rejects.toThrow("already connected to another team")
  expect(graph.to(/subscribed_apps$/)).toHaveLength(0)
  graph.calls.length = 0
  await expect(
    f.outsider.client.action(api.meta.pageConnectActions.connectPageManual, {
      organizationId: f.owner.team,
      pageId: PAGE_ID,
      token: PAGE_TOKEN,
    })
  ).rejects.toThrow()
  expect(graph.calls).toHaveLength(0)
})
test("wrong app, missing scopes and asset-scoped tokens are refused", async () => {
  const f = await metaFixture()
  for (const data of [
    { app_id: "wrong", is_valid: true, scopes: [] },
    { app_id: "1234567890", is_valid: true, scopes: ["pages_messaging"] },
    {
      app_id: "1234567890",
      is_valid: true,
      scopes: ["pages_messaging", "pages_manage_metadata"],
      granular_scopes: [{ scope: "pages_messaging", target_ids: ["999"] }],
    },
  ]) {
    graph.use({ path: "/debug_token", respond: () => ({ data }) })
    await expect(
      f.owner.client.action(api.meta.pageConnectActions.connectPageManual, {
        organizationId: f.owner.team,
        pageId: PAGE_ID,
        token: PAGE_TOKEN,
      })
    ).rejects.toThrow()
  }
  expect(graph.to(/subscribed_apps$/)).toHaveLength(0)
})
test("disconnect frees Page/IG ownership, preserves history, and does not unsubscribe a reconnected Page", async () => {
  const f = await setup()
  const account = await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", f.accounts[0].id)
  )
  await f.owner.client.mutation(api.meta.connect.disconnect, {
    connectionId: account!.connectionId,
  })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(graph.to(`/${PAGE_ID}/subscribed_apps`, "DELETE")).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(2)
  const next = await f.outsider.client.action(
    api.meta.pageConnectActions.connectPageManual,
    { organizationId: f.outsider.team, pageId: PAGE_ID, token: PAGE_TOKEN }
  )
  expect(next.accounts[0].id).not.toBe(f.accounts[0].id)
  await f.t.action(internal.meta.pageConnectActions.unsubscribe, {
    pages: [
      {
        pageId: PAGE_ID,
        encryptedToken: (await f.t.run((ctx) =>
          ctx.db.get("metaConnections", account!.connectionId)
        ))!.encryptedToken,
      },
    ],
  })
  expect(graph.to(`/${PAGE_ID}/subscribed_apps`, "DELETE")).toHaveLength(1)
})
test("health and sync refresh both linked accounts and mark revoked tokens", async () => {
  const f = await pagesFixture()
  graph.use({
    method: "GET",
    path: `/${PAGE_ID}`,
    respond: () => ({
      ...PAGE,
      name: "Renamed",
      instagram_business_account: {
        ...PAGE.instagram_business_account,
        username: "renamed",
      },
    }),
  })
  await f.owner.client.action(api.meta.connectActions.syncAccount, {
    accountId: f.accounts[1].id,
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("channelAccounts", f.accounts[1].id))
  ).toMatchObject({ handle: "renamed" })
  await f.t.mutation(internal.meta.connect.dispatchHealthChecks, {})
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  const account = await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", f.accounts[0].id)
  )
  expect(account?.displayName).toBe("Renamed")
  graph.use({
    path: "/debug_token",
    respond: () => graphError("Expired", 190, 401),
  })
  await f.t.action(internal.meta.connectActions.checkConnection, {
    connectionId: account!.connectionId,
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("metaConnections", account!.connectionId))
  ).toMatchObject({ status: "error" })
})
test("inbound Page/IG messages create scoped identities, contacts and windows; profile enrichment is best effort", async () => {
  const f = await setup()
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  const identities = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").collect()
  )
  expect(identities).toHaveLength(2)
  expect(identities.find((i) => i.channel === "messenger")).toMatchObject({
    scopeId: PAGE_ID,
    externalId: PSID,
    profileName: "Ada Lovelace",
  })
  expect(identities.find((i) => i.channel === "instagram")).toMatchObject({
    scopeId: IG_ID,
    externalId: IGSID,
    profileName: "Grace Hopper",
  })
  const contacts = await f.t.run((ctx) => ctx.db.query("contacts").collect())
  expect(contacts).toHaveLength(2)
  expect(contacts.every((c) => !c.email && !c.phone)).toBe(true)
  const threads = await f.t.run((ctx) =>
    ctx.db.query("conversations").collect()
  )
  expect(
    threads.every(
      (c) =>
        c.windowExpiresAt === c.lastInboundAt! + 86400_000 &&
        c.unreadCount === 1
    )
  ).toBe(true)
  const events = await f.t.run((ctx) => ctx.db.query("events").collect())
  for (const channel of ["messenger", "instagram"])
    expect(events.map((e) => e.type)).toContain(`${channel}.message.received`)
  await project(
    f,
    pageEnvelope("messenger", {
      message: { mid: "mid.messenger", text: "Replay" },
    })
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(2)
})
test("echoes and unknown accounts are ignored, postbacks and reactions are recorded", async () => {
  const f = await setup(false)
  await project(
    f,
    pageEnvelope("messenger", {
      message: { mid: "mid.echo", is_echo: true, text: "Echo" },
    })
  )
  const unknown = pageEnvelope("messenger", {
    message: { mid: "mid.unknown", text: "Unknown" },
  })
  unknown.entry[0].id = "999"
  await project(f, unknown)
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(0)
  await project(
    f,
    pageEnvelope("messenger", {
      postback: { mid: "mid.button", title: "Start", payload: "GET_STARTED" },
    })
  )
  await project(
    f,
    pageEnvelope("instagram", {
      reaction: { mid: "mid.parent", emoji: "❤️", action: "react" },
    })
  )
  const messages = await f.t.run((ctx) =>
    ctx.db.query("channelMessages").collect()
  )
  expect(messages.map((m) => m.type).sort()).toEqual(["button", "reaction"])
  expect(
    await (
      await f.call(
        `/messenger/messages/${messages.find((m) => m.type === "button")!._id}`
      )
    ).json()
  ).toMatchObject({ button: { payload: "GET_STARTED" } })
})
test("attachment URLs are downloaded without disclosing Page credentials and stored behind signed links", async () => {
  const f = await setup(false)
  graph.use({
    path: "/attachment",
    respond: () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/png" },
      }),
  })
  await project(
    f,
    pageEnvelope("instagram", {
      message: {
        mid: "mid.image",
        attachments: [
          {
            type: "image",
            payload: { url: "https://cdn.example.test/attachment" },
          },
        ],
      },
    })
  )
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(graph.to("/attachment")[0].authorization).toBeUndefined()
  const message = await f.t.run((ctx) =>
    ctx.db.query("channelMessages").first()
  )
  const response = await f.call(`/instagram/messages/${message!._id}`)
  expect(await response.json()).toMatchObject({
    type: "image",
    media: [
      { size: 3, download_url: expect.stringContaining("/channels/media/") },
    ],
  })
})
test("inside-window sends use RESPONSE, Page endpoint/token, idempotency, and monotonic delivery/read statuses", async () => {
  const f = await setup()
  const body = {
    to: PSID,
    text: "Reply",
    quick_replies: [{ title: "Yes", payload: "YES" }],
  }
  const first = await f.call("/messenger/messages", "POST", body, "same-send")
  const id = (await first.json()).id as Id<"channelMessages">
  expect(
    await (
      await f.call("/messenger/messages", "POST", body, "same-send")
    ).json()
  ).toEqual({ id })
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  expect(graph.to(`/${PAGE_ID}/messages`)).toHaveLength(1)
  expect(graph.to(`/${PAGE_ID}/messages`)[0]).toMatchObject({
    authorization: `Bearer ${PAGE_TOKEN}`,
    body: {
      recipient: { id: PSID },
      messaging_type: "RESPONSE",
      message: {
        text: "Reply",
        quick_replies: [{ content_type: "text", title: "Yes", payload: "YES" }],
      },
    },
  })
  expect(await f.message(id)).toMatchObject({
    status: "sent",
    externalId: "mid.sent",
  })
  await project(
    f,
    pageEnvelope("messenger", { delivery: { mids: ["mid.sent"] } })
  )
  expect((await f.message(id))?.status).toBe("delivered")
  await project(
    f,
    pageEnvelope("messenger", { read: { watermark: Date.now() } })
  )
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect((await f.message(id))?.status).toBe("read")
  await project(
    f,
    pageEnvelope(
      "messenger",
      { delivery: { mids: ["mid.sent"] } },
      Date.now() + 1
    )
  )
  expect((await f.message(id))?.status).toBe("read")
  const detail = await (await f.call(`/messenger/messages/${id}`)).json()
  expect(detail).toMatchObject({
    text: "Reply",
    last_event: "read",
    events: expect.arrayContaining([expect.objectContaining({ type: "read" })]),
  })
  const ig = await f.send("instagram")
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  expect((await f.message(ig))?.status).toBe("sent")
  await project(f, pageEnvelope("instagram", { read: { mid: "mid.sent" } }))
  expect((await f.message(ig))?.status).toBe("read")
})
test("window enforcement includes templates, HUMAN_AGENT expiry and a window that closes while queued", async () => {
  const f = await setup()
  vi.setSystemTime(Date.now() + 2 * 86400_000)
  const closed = await f.call("/messenger/messages", "POST", {
    to: PSID,
    text: "Closed",
  })
  expect(closed.status).toBe(422)
  expect((await closed.json()).message).toBe(
    "The 24-hour messaging window is closed. Pass a message tag such as HUMAN_AGENT."
  )
  const human = await f.send("messenger", { tag: "HUMAN_AGENT" })
  const claim = await f.t.mutation(internal.channels.messages.claim, {
    id: human,
    generation: 0,
  })
  expect(JSON.parse(claim!.payload)).toMatchObject({
    messaging_type: "MESSAGE_TAG",
    tag: "HUMAN_AGENT",
  })
  vi.setSystemTime(Date.now() + 6 * 86400_000)
  expect(
    (
      await f.call("/instagram/messages", "POST", {
        to: IGSID,
        text: "Expired",
        tag: "HUMAN_AGENT",
      })
    ).status
  ).toBe(422)
  await project(
    f,
    pageEnvelope("messenger", {
      message: { mid: "mid.reopen", text: "New window" },
    })
  )
  const queued = await f.send()
  vi.setSystemTime(Date.now() + 86400_000)
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: queued,
      generation: 0,
    })
  ).toBeNull()
  expect(await f.message(queued)).toMatchObject({
    status: "failed",
    errorCode: 2018278,
  })
})
test.each([551, 10, 2018278, 190, 4])(
  "Graph error %i maps to final failure, invalid token or retry",
  async (code) => {
    const f = await setup(),
      id = await f.send()
    graph.use({
      method: "POST",
      path: `/${PAGE_ID}/messages`,
      respond: () => graphError("Meta refused", code),
    })
    await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
    expect(await f.message(id)).toMatchObject(
      code === 4
        ? { status: "queued", generation: 1, claimed: false }
        : { status: "failed", errorCode: code }
    )
  }
)
test("local templates publish without Meta, substitute variables by alias/id and preserve the published copy", async () => {
  const f = await setup()
  for (const channel of ["messenger", "instagram"] as const) {
    const response = await f.call("/templates", "POST", {
      channel,
      name: `${channel} welcome`,
      text: "Hello {{{name}}}",
      quick_replies: [{ title: "Yes", payload: "YES_{{{name}}}" }],
    })
    expect(response.status, await response.clone().text()).toBe(201)
    const id = (await response.json()).id as Id<"templates">
    expect((await f.call(`/templates/${id}/publish`, "POST", {})).status).toBe(
      200
    )
    expect(graph.to(/message_templates$/)).toHaveLength(0)
    const detail = await (await f.call(`/templates/${id}`)).json()
    expect(detail).toMatchObject({
      channel,
      text: "Hello {{{name}}}",
      quick_replies: [{ title: "Yes", payload: "YES_{{{name}}}" }],
    })
    const messageId = await f.send(channel, {
      text: undefined,
      template: { alias: detail.alias, variables: { name: 'Ada "L"' } },
    })
    const contents = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
        .unique()
    )
    expect(JSON.parse(contents!.payload)).toMatchObject({
      message: {
        text: 'Hello Ada "L"',
        quick_replies: [{ payload: 'YES_Ada "L"' }],
      },
    })
    await f.call(`/templates/${id}`, "PATCH", {
      text: "Draft edit",
      quick_replies: [],
    })
    const snapshot = await f.send(channel, {
      text: undefined,
      template: { id, variables: { name: "Grace" } },
    })
    expect((await f.message(snapshot))?.preview).toBe("Hello Grace")
    const sentMessage = (await f.message(snapshot))!
    const rendered = {
      body: "Hello Grace",
      buttons: [{ type: "QUICK_REPLY", text: "Yes" }],
    }
    expect(
      await f.member.client.query(api.messages.get, { id: snapshot })
    ).toMatchObject({ rendered })
    const bubbles = await f.member.client.query(api.conversations.messages, {
      id: sentMessage.conversationId,
      paginationOpts: { cursor: null, numItems: 20 },
    })
    expect(bubbles.page.find((bubble) => bubble.id === snapshot)).toMatchObject(
      { text: "Hello Grace", rendered }
    )
    expect(
      (
        await f.call(`/${channel}/messages`, "POST", {
          to: channel === "messenger" ? PSID : IGSID,
          template: { id },
        })
      ).status
    ).toBe(422)
    const repliesOnly = await f.call(`/templates/${id}`, "PATCH", {
      quick_replies: [{ title: "Done", payload: "DONE" }],
    })
    expect(repliesOnly.status).toBe(200)
    expect((await (await f.call(`/templates/${id}`)).json()).text).toBe(
      "Draft edit"
    )
    const thread = await f.t.run((ctx) =>
      ctx.db
        .query("conversations")
        .withIndex("by_accountId_and_channelContactId", (q) =>
          q.eq("accountId", f.accounts.find((a) => a.channel === channel)!.id)
        )
        .first()
    )
    await f.t.run((ctx) =>
      ctx.db.patch("conversations", thread!._id, {
        windowExpiresAt: Date.now() - 1,
      })
    )
    expect(
      (
        await f.call(`/${channel}/messages`, "POST", {
          to: channel === "messenger" ? PSID : IGSID,
          template: { id, variables: { name: "Ada" } },
        })
      ).status
    ).toBe(422)
    expect(
      await f.t.query(internal.templates.published, {
        organizationId: f.owner.team,
        idOrAlias: id,
      })
    ).toBeNull()
  }
})
test("REST lists, account resources, cursors and conversations stay isolated across teams/channels", async () => {
  const f = await setup()
  const { token } = await f.outsider.client.action(api.apiKeys.create, {
    organizationId: f.outsider.team,
    input: { name: "Other", permission: "full_access", domainId: null },
  })
  for (const [channel, resource, externalId] of [
    ["messenger", "pages", PAGE_ID],
    ["instagram", "accounts", IG_ID],
  ]) {
    const list = await (await f.call(`/${channel}/messages`)).json()
    expect(list.data).toHaveLength(1)
    const own = list.data[0]
    expect(
      (
        await f.call(
          `/${channel}/messages/${own.id}`,
          "GET",
          undefined,
          undefined,
          token
        )
      ).status
    ).toBe(404)
    expect(
      (
        await f.call(
          `/${channel}/messages?after=${own.id}`,
          "GET",
          undefined,
          undefined,
          token
        )
      ).status
    ).toBe(422)
    const accounts = await (await f.call(`/${channel}/${resource}`)).json()
    expect(accounts.data).toHaveLength(1)
    expect(accounts.data[0]).toMatchObject({
      external_id: externalId,
      page_id: PAGE_ID,
    })
    expect((await f.call(`/${channel}/${resource}/${externalId}`)).status).toBe(
      200
    )
    expect(
      (
        await f.call(
          `/${channel}/${resource}/${externalId}`,
          "GET",
          undefined,
          undefined,
          token
        )
      ).status
    ).toBe(404)
    expect((await f.call(`/${channel}/conversations`)).status).toBe(200)
    const thread = await (
      await f.call(`/${channel}/conversations/${own.conversation_id}/messages`)
    ).json()
    expect(thread.data[0].id).toBe(own.id)
    expect(
      (
        await f.call(
          `/${channel}/conversations/${own.conversation_id}/messages`,
          "GET",
          undefined,
          undefined,
          token
        )
      ).status
    ).toBe(404)
  }
})

test("status before send record retries independently and cannot duplicate an inbound batch", async () => {
  const f = await setup(),
    id = await f.send()
  const batch = pageEnvelope("messenger", {
    message: { mid: "mid.atomic", text: "New inbound" },
  })
  batch.entry[0].messaging.push({
    ...batch.entry[0].messaging[0],
    message: undefined,
    delivery: { mids: ["mid.race"] },
  })
  const eventId = await project(f, batch)
  expect(
    (await f.t.run((ctx) => ctx.db.get("metaWebhookEvents", eventId)))
      ?.projectedAt
  ).toEqual(expect.any(Number))
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(4)
  await f.t.mutation(internal.channels.messages.record, {
    id,
    generation: 0,
    outcome: { kind: "sent", externalId: "mid.race" },
  })
  await f.t.mutation(internal.meta.projection.project, {
    id: eventId,
    attempt: 1,
    statusIndexes: [1],
  })
  expect((await f.message(id))?.status).toBe("delivered")
  await f.t.mutation(internal.meta.projection.project, { id: eventId })
  expect(
    await f.t.run((ctx) => ctx.db.query("channelMessages").collect())
  ).toHaveLength(4)
})
test("Page and Instagram share a per-Page bucket, with a separate audio/video limit", async () => {
  const f = await setup()
  await f.t.run(async (ctx) => {
    for (const account of f.accounts)
      await ctx.db.patch("channelAccounts", account.id, { throughputMps: 2 })
  })
  const messenger = await f.send(),
    ig = await f.send("instagram"),
    pending = await f.send()
  // Keep all claims in the same second after queueing.
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: messenger,
      generation: 0,
    })
  ).not.toBeNull()
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: ig,
      generation: 0,
    })
  ).not.toBeNull()
  expect(
    await f.t.mutation(internal.channels.messages.claim, {
      id: pending,
      generation: 0,
    })
  ).toBeNull()
  expect(await f.message(pending)).toMatchObject({
    status: "queued",
    generation: 1,
    rateReadyAt: expect.any(Number),
  })
  await f.t.run(async (ctx) => {
    for (const account of f.accounts)
      await ctx.db.patch("channelAccounts", account.id, { throughputMps: 300 })
  })
  const media = []
  for (let i = 0; i < 11; i++)
    media.push(
      await f.send("messenger", {
        text: undefined,
        attachment: { type: "audio", url: "https://example.com/a.mp3" },
      })
    )
  const claims = []
  for (const id of media)
    claims.push(
      await f.t.mutation(internal.channels.messages.claim, {
        id,
        generation: 0,
      })
    )
  expect(claims.filter(Boolean)).toHaveLength(10)
  expect(await f.message(media[10])).toMatchObject({
    generation: 1,
    rateReadyAt: expect.any(Number),
  })
})
test("linked channel contacts remain editable without inventing email or phone, and profile refresh keeps CRM names", async () => {
  const f = await setup()
  const identity = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").first()
  )
  await f.owner.client.mutation(api.contacts.update, {
    id: identity!.contactId!,
    firstName: "CRM",
    lastName: "Name",
  })
  await f.t.action(internal.meta.pageConnectActions.profile, {
    identityId: identity!._id,
    accountId: f.accounts.find((a) => a.channel === identity!.channel)!.id,
  })
  expect(
    await f.t.run((ctx) => ctx.db.get("contacts", identity!.contactId!))
  ).toMatchObject({ firstName: "CRM", lastName: "Name" })
})

test("admin subscribes the app to WhatsApp, page and Instagram objects", async () => {
  const f = await metaFixture()
  graph.use({
    method: "POST",
    path: "/1234567890/subscriptions",
    respond: () => ({ success: true }),
  })
  await f.owner.client.action(api.meta.appActions.subscribeWebhooks, {})
  expect(
    graph.to("/1234567890/subscriptions").map((call) => call.body)
  ).toEqual([
    expect.objectContaining({ object: "whatsapp_business_account" }),
    expect.objectContaining({
      object: "page",
      fields:
        "messages,message_deliveries,message_reads,messaging_postbacks,message_echoes",
    }),
    expect.objectContaining({
      object: "instagram",
      fields: "messages,messaging_postbacks,message_reactions,messaging_seen",
    }),
  ])
})

test("reconnecting a Page retires an unlinked Instagram endpoint and inbound routes to the current team", async () => {
  const f = await setup()
  graph.use({
    method: "GET",
    path: `/${PAGE_ID}`,
    respond: () => ({
      id: PAGE_ID,
      name: "Acme Page",
      access_token: PAGE_TOKEN,
    }),
  })
  const reconnect = await f.owner.client.action(
    api.meta.pageConnectActions.connectPageManual,
    { organizationId: f.owner.team, pageId: PAGE_ID, token: PAGE_TOKEN }
  )
  expect(reconnect.accounts.map((a) => a.channel)).toEqual(["messenger"])
  const oldInstagram = await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", f.accounts[1].id)
  )
  expect(oldInstagram).toMatchObject({
    status: "disconnected",
    disconnectedAt: expect.any(Number),
  })
  const messenger = await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", f.accounts[0].id)
  )
  await f.owner.client.mutation(api.meta.connect.disconnect, {
    connectionId: messenger!.connectionId,
  })
  await f.outsider.client.action(
    api.meta.pageConnectActions.connectPageManual,
    { organizationId: f.outsider.team, pageId: PAGE_ID, token: PAGE_TOKEN }
  )
  // A scoped mid from the old owner's history must not dedupe another team's message.
  await project(
    f,
    pageEnvelope(
      "messenger",
      { message: { mid: "mid.messenger", text: "New owner" } },
      Date.now() + 1
    )
  )
  const routed = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessages")
      .withIndex("by_organizationId_and_channel", (q) =>
        q.eq("organizationId", f.outsider.team).eq("channel", "messenger")
      )
      .first()
  )
  expect(routed).toMatchObject({
    organizationId: f.outsider.team,
    preview: "New owner",
  })
})

test("profile enrichment is scheduled only once even when Meta cannot return a name", async () => {
  graph.use({ path: `/${PSID}`, respond: () => ({}) })
  const f = await setup(false)
  for (let i = 0; i < 2; i++) {
    await project(
      f,
      pageEnvelope("messenger", {
        message: { mid: `mid.profile.${i}`, text: "Hello" },
      })
    )
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(100))
  }
  expect(graph.to(`/${PSID}`)).toHaveLength(1)
  const identity = await f.t.run((ctx) =>
    ctx.db.query("channelContacts").first()
  )
  expect(identity?.profileLookedUpAt).toEqual(expect.any(Number))
  expect(identity?.profileName).toBeUndefined()
})

test("a queued HUMAN_AGENT reply uses the tag after its 24-hour window closes, retaining the stored payload", async () => {
  const f = await setup()
  const id = await f.send("messenger", { tag: "HUMAN_AGENT" })
  const stored = await f.t.run((ctx) =>
    ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", id))
      .unique()
  )
  const raw = JSON.stringify(JSON.parse(stored!.payload), null, 2)
  await f.t.run((ctx) =>
    ctx.db.patch("channelMessageContents", stored!._id, { payload: raw })
  )
  vi.setSystemTime(Date.now() + 2 * 86400_000)
  const claim = await f.t.mutation(internal.channels.messages.claim, {
    id,
    generation: 0,
  })
  expect(claim!.payload).toBe(raw)
  expect(claim!.messagingType).toBe("MESSAGE_TAG")
})

test("statuses resolved once in a batch remain monotonic when read precedes delivered", async () => {
  const f = await setup()
  const id = await f.send()
  await f.t.action(internal.channels.deliver.deliver, { id, generation: 0 })
  const event = pageEnvelope("messenger", { read: { mid: "mid.sent" } })
  const delivered = pageEnvelope("messenger", {
    delivery: { mids: ["mid.sent"] },
  })
  event.entry[0].messaging.push(...delivered.entry[0].messaging)
  await project(f, event)
  expect((await f.message(id))?.status).toBe("read")
})

for (const channel of ["messenger", "instagram"] as const) {
  test(`dashboard ${channel} tests use the published copy and existing conversation window`, async () => {
    const f = await setup()
    const templateId = await f.owner.client.mutation(api.templates.create, {
      organizationId: f.owner.team,
      channel,
      name: "Test greeting",
      content: {
        text: "Hi {{{name}}}",
        quick_replies: [{ title: "Thanks", payload: "THANKS" }],
      },
    })
    const accounts = await f.owner.client.query(api.channels.senders.list, {
      organizationId: f.owner.team,
      channel,
      paginationOpts: { cursor: null, numItems: 10 },
    })
    const row = accounts.page.find((row) => row.kind === "account")!
    const args = {
      organizationId: f.owner.team,
      templateId,
      from: row.kind === "account" ? row.account._id : "",
      to: channel === "messenger" ? PSID : IGSID,
      variables: { name: "Ada" },
    }
    await expect(
      f.owner.client.mutation(api.messages.sendTest, args)
    ).rejects.toThrow("Publish")
    await f.owner.client.mutation(api.templates.publish, { id: templateId })
    await f.owner.client.mutation(api.templates.update, {
      id: templateId,
      content: { text: "Unpublished edit" },
    })
    expect(
      await f.owner.client.query(api.messages.testDefinition, {
        organizationId: f.owner.team,
        templateId,
      })
    ).toEqual({ variables: [{ key: "name", label: "Variable {{{name}}}" }] })
    const listed = await f.owner.client.query(api.templates.list, {
      organizationId: f.owner.team,
      channel,
      paginationOpts: { cursor: null, numItems: 20 },
    })
    expect(
      listed.page.find((template) => template._id === templateId)?.content
    ).toMatchObject({
      text: "Unpublished edit",
      quick_replies: [{ title: "Thanks", payload: "THANKS" }],
    })
    const sent = await f.owner.client.mutation(api.messages.sendTest, args)
    expect(await f.message(sent)).toMatchObject({
      channel,
      source: "dashboard",
      status: "queued",
      preview: "Hi Ada",
    })
    await expect(
      f.outsider.client.mutation(api.messages.sendTest, {
        ...args,
        organizationId: f.outsider.team,
      })
    ).rejects.toThrow("Template not found")
    await f.t.run(async (ctx) => {
      const message = await ctx.db.get("channelMessages", sent)
      await ctx.db.patch("conversations", message!.conversationId, {
        windowExpiresAt: Date.now() - 1,
      })
    })
    await expect(
      f.owner.client.mutation(api.messages.sendTest, args)
    ).rejects.toThrow("window")
  })
}
