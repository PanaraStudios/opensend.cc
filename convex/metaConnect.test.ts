/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { decryptSecret } from "./secrets"
import {
  META_APP,
  fakeGraph,
  graphError,
  metaFixture,
  type GraphRoute,
} from "./testHelpers/meta.fixture"

const WABA = "5550001"
const OTHER_WABA = "5550002"
const PHONE = "1060001"
const OTHER_PHONE = "1060002"
const BUSINESS = "7770001"
const BUSINESS_TOKEN = "EAABusinessToken0123456789abcdef"
const MANUAL_TOKEN = "EAASystemUserToken0123456789abcd"
const WABA_TAKEN =
  "This WhatsApp Business Account is already connected to another team"

const number = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  display_phone_number: `+1 555-010-${id.slice(-4)}`,
  verified_name: "Acme",
  quality_rating: "GREEN",
  status: "PENDING",
  platform_type: "NOT_APPLICABLE",
  throughput: { level: "STANDARD" },
  whatsapp_business_manager_messaging_limit: "TIER_250",
  ...fields,
})
const phones: Record<string, string> = {
  [WABA]: PHONE,
  [OTHER_WABA]: OTHER_PHONE,
}
let tokenInfo: Record<string, unknown>
let numberFields: Record<string, unknown>

/** Meta, as the connect flow calls it. */
const ROUTES: GraphRoute[] = [
  {
    method: "GET",
    path: "/oauth/access_token",
    respond: () => ({ access_token: BUSINESS_TOKEN, token_type: "bearer" }),
  },
  {
    method: "GET",
    path: "/debug_token",
    respond: () => ({
      data: {
        app_id: META_APP.appId,
        is_valid: true,
        scopes: [
          "whatsapp_business_management",
          "whatsapp_business_messaging",
          "business_management",
        ],
        ...tokenInfo,
      },
    }),
  },
  {
    path: /^\/(\d+)\/subscribed_apps$/,
    respond: () => ({ success: true }),
  },
  {
    method: "GET",
    path: /^\/(\d+)\/phone_numbers$/,
    respond: (_, match) => ({
      data: [number(phones[match![1]], numberFields)],
    }),
  },
  {
    method: "POST",
    path: /^\/\d+\/register$/,
    respond: () => ({ success: true }),
  },
  {
    method: "GET",
    path: /^\/(\d+)$/,
    respond: (_, match) => {
      const id = match![1]
      if (Object.values(phones).includes(id)) return number(id, numberFields)
      return { id, name: id === BUSINESS ? "Acme Inc" : `WABA ${id}` }
    },
  },
]

let graph: ReturnType<typeof fakeGraph>
beforeEach(() => {
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  tokenInfo = {}
  numberFields = {}
  graph = fakeGraph(ROUTES)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function setup() {
  const f = await metaFixture()
  const manual = (
    actor: { client: typeof f.owner.client; team: string },
    wabaId = WABA,
    token = MANUAL_TOKEN
  ) =>
    actor.client.action(api.meta.connectActions.connectManual, {
      organizationId: actor.team,
      token,
      wabaId,
    })
  const accounts = (actor = f.owner) =>
    actor.client.query(api.meta.connect.listAccounts, {
      organizationId: actor.team,
      paginationOpts: { cursor: null, numItems: 10 },
    })
  const count = (actor = f.owner) =>
    actor.client.query(api.meta.connect.countAccounts, {
      organizationId: actor.team,
    })
  const connection = (id: Id<"metaConnections">) =>
    f.t.run((ctx) => ctx.db.get("metaConnections", id))
  const account = (id: Id<"channelAccounts">) =>
    f.t.run((ctx) => ctx.db.get("channelAccounts", id))
  return { ...f, manual, accounts, count, connection, account }
}

describe("Meta connect", () => {
  test("the team reads the app's public config, never its secret", async () => {
    const f = await setup()
    const config = await f.member.client.query(api.meta.app.publicConfig, {
      organizationId: f.owner.team,
    })
    expect(config).toEqual({
      configured: true,
      appId: META_APP.appId,
      configIds: META_APP.configIds,
      graphVersion: "v25.0",
    })
    await expect(
      f.outsider.client.query(api.meta.app.publicConfig, {
        organizationId: f.owner.team,
      })
    ).rejects.toThrow()
    await f.owner.client.mutation(api.meta.app.disconnect, {})
    expect(
      await f.owner.client.query(api.meta.app.publicConfig, {
        organizationId: f.owner.team,
      })
    ).toEqual({ configured: false, configIds: {}, graphVersion: "v25.0" })
    await expect(f.manual(f.owner)).rejects.toThrow(
      "Your administrator needs to set up the Meta app"
    )
    expect(graph.calls).toEqual([])
  })

  test("Embedded Signup exchanges the code, checks the token and attaches the WABA", async () => {
    const f = await setup()
    tokenInfo = {
      granular_scopes: [
        { scope: "whatsapp_business_management", target_ids: [WABA] },
        { scope: "whatsapp_business_messaging", target_ids: [WABA] },
      ],
    }
    const result = await f.owner.client.action(
      api.meta.connectActions.exchangeEmbeddedSignup,
      {
        organizationId: f.owner.team,
        code: "signup-code",
        wabaId: WABA,
        phoneNumberId: PHONE,
        businessId: BUSINESS,
      }
    )
    expect(result.accounts).toEqual([
      { id: expect.any(String), handle: "+1 555-010-0001", registered: false },
    ])
    const appToken = `Bearer ${META_APP.appId}|${META_APP.appSecret}`
    expect(graph.to("/oauth/access_token")).toEqual([
      expect.objectContaining({
        version: "v25.0",
        query: {
          client_id: META_APP.appId,
          client_secret: META_APP.appSecret,
          code: "signup-code",
        },
      }),
    ])
    expect(graph.to("/debug_token")).toEqual([
      expect.objectContaining({
        query: { input_token: BUSINESS_TOKEN },
        authorization: appToken,
      }),
    ])
    expect(graph.to(`/${WABA}/subscribed_apps`)).toEqual([
      expect.objectContaining({
        method: "POST",
        authorization: `Bearer ${BUSINESS_TOKEN}`,
      }),
    ])
    expect(graph.to(`/${WABA}/phone_numbers`)[0].query).toEqual({
      fields:
        "id,display_phone_number,verified_name,quality_rating,status,code_verification_status,platform_type,throughput,whatsapp_business_manager_messaging_limit",
      limit: "100",
    })

    const connection = (await f.connection(result.connectionId))!
    expect(connection).toMatchObject({
      organizationId: f.owner.team,
      businessId: BUSINESS,
      businessName: "Acme Inc",
      method: "embedded_signup",
      tokenLast4: BUSINESS_TOKEN.slice(-4),
      status: "active",
    })
    expect(connection.encryptedToken).not.toContain(BUSINESS_TOKEN)
    expect(await decryptSecret(connection.encryptedToken)).toBe(BUSINESS_TOKEN)
    const waba = await f.t.run((ctx) =>
      ctx.db.query("whatsappBusinessAccounts").unique()
    )
    expect(waba).toMatchObject({
      organizationId: f.owner.team,
      wabaId: WABA,
      connectionId: result.connectionId,
      name: `WABA ${WABA}`,
      subscribedAt: expect.any(Number),
    })

    const list = await f.accounts()
    expect(list.page).toHaveLength(1)
    expect(list.page[0]).toMatchObject({
      channel: "whatsapp",
      externalId: PHONE,
      wabaId: WABA,
      displayName: "Acme",
      handle: "+1 555-010-0001",
      status: "pending",
      quality: "green",
      throughputMps: 80,
      messagingLimit: "TIER_250",
      businessName: "Acme Inc",
    })
    expect(list.page[0]).not.toHaveProperty("encryptedToken")
    expect(await f.count()).toEqual({ total: 1 })
    const detail = await f.member.client.query(api.meta.connect.getAccount, {
      id: list.page[0]._id,
    })
    expect(detail?.connection).not.toHaveProperty("encryptedToken")
    expect(detail?.wabaName).toBe(`WABA ${WABA}`)
    expect(
      await f.outsider.client
        .query(api.meta.connect.getAccount, { id: list.page[0]._id })
        .catch(() => "refused")
    ).toBe("refused")
  })

  test("a member connects with a token; a bad token or an outsider is refused", async () => {
    const f = await setup()
    await expect(
      f.manual({ client: f.outsider.client, team: f.owner.team })
    ).rejects.toThrow()
    await expect(
      f.member.client.action(api.meta.connectActions.connectManual, {
        organizationId: f.owner.team,
        token: "short",
        wabaId: WABA,
      })
    ).rejects.toThrow("Paste the system user access token")
    tokenInfo = { app_id: "999" }
    await expect(
      f.member.client.action(api.meta.connectActions.connectManual, {
        organizationId: f.owner.team,
        token: MANUAL_TOKEN,
        wabaId: WABA,
      })
    ).rejects.toThrow("The token belongs to a different Meta app")
    tokenInfo = {
      granular_scopes: [
        { scope: "whatsapp_business_management", target_ids: [OTHER_WABA] },
      ],
    }
    await expect(
      f.manual({ client: f.member.client, team: f.owner.team })
    ).rejects.toThrow("no access to this WhatsApp Business Account")
    expect(graph.to(/subscribed_apps$/)).toEqual([])
    expect(await f.count()).toEqual({ total: 0 })

    tokenInfo = {}
    const result = await f.manual({
      client: f.member.client,
      team: f.owner.team,
    })
    // Without a business from Meta, the WABA stands for it.
    expect(await f.connection(result.connectionId)).toMatchObject({
      method: "manual_token",
      businessId: WABA,
      businessName: `WABA ${WABA}`,
      tokenLast4: MANUAL_TOKEN.slice(-4),
    })
    expect(graph.to("/oauth/access_token")).toEqual([])
    expect((await f.accounts()).page).toHaveLength(1)
  })

  test("a WABA another team holds is refused before Meta is called", async () => {
    const f = await setup()
    await f.manual(f.owner)
    graph.calls.length = 0
    await expect(f.manual(f.outsider)).rejects.toThrow(WABA_TAKEN)
    expect(graph.to(/subscribed_apps$/)).toEqual([])
    expect(await f.count(f.outsider)).toEqual({ total: 0 })
    // The same team connects it again without a second row.
    await f.manual(f.owner)
    expect((await f.accounts()).page).toHaveLength(1)
  })

  test("registering a number posts the PIN and activates it", async () => {
    const f = await setup()
    const { accounts } = await f.manual(f.owner)
    const accountId = accounts[0].id
    await expect(
      f.owner.client.action(api.meta.connectActions.registerNumber, {
        accountId,
        pin: "12345",
      })
    ).rejects.toThrow("Enter a 6-digit PIN")
    await expect(
      f.outsider.client.action(api.meta.connectActions.registerNumber, {
        accountId,
        pin: "123456",
      })
    ).rejects.toThrow()
    expect(graph.to(/register$/)).toEqual([])
    await f.member.client.action(api.meta.connectActions.registerNumber, {
      accountId,
      pin: "123456",
    })
    expect(graph.to(`/${PHONE}/register`)).toEqual([
      expect.objectContaining({
        method: "POST",
        body: { messaging_product: "whatsapp", pin: "123456" },
        authorization: `Bearer ${MANUAL_TOKEN}`,
      }),
    ])
    expect(await f.account(accountId)).toMatchObject({
      status: "active",
      registeredAt: expect.any(Number),
    })
    // The PIN is never stored.
    const dump = await f.t.run(async (ctx) =>
      JSON.stringify([
        await ctx.db.query("channelAccounts").collect(),
        await ctx.db.query("metaConnections").collect(),
      ])
    )
    expect(dump).not.toContain("123456")

    // Sync reads the number; Meta's platform type now says Cloud API.
    numberFields = {
      status: "CONNECTED",
      platform_type: "CLOUD_API",
      quality_rating: "YELLOW",
      throughput: { level: "HIGH" },
    }
    await f.owner.client.action(api.meta.connectActions.syncAccount, {
      accountId,
    })
    expect(graph.to(`/${PHONE}`)[0].query.fields).toContain("throughput")
    expect(await f.account(accountId)).toMatchObject({
      status: "active",
      quality: "yellow",
      throughputMps: 1000,
    })
  })

  test("a refused token (190) marks the connection for reconnecting", async () => {
    const f = await setup()
    const { connectionId, accounts } = await f.manual(f.owner)
    graph.use({
      method: "POST",
      path: /register$/,
      respond: () => graphError("Error validating access token", 190, 401),
    })
    await expect(
      f.owner.client.action(api.meta.connectActions.registerNumber, {
        accountId: accounts[0].id,
        pin: "123456",
      })
    ).rejects.toThrow("Meta refused the business token")
    expect(await f.connection(connectionId)).toMatchObject({
      status: "error",
      error: "Meta refused the business token. Reconnect the business.",
    })
    await expect(
      f.owner.client.action(api.meta.connectActions.syncAccount, {
        accountId: accounts[0].id,
      })
    ).rejects.toThrow("Reconnect this business")
    // Another Graph error is shown without flagging anything.
    const other = await f.manual(f.owner, OTHER_WABA)
    graph.use({
      method: "GET",
      path: `/${OTHER_PHONE}`,
      respond: () => graphError("Unsupported get request", 100),
    })
    await expect(
      f.owner.client.action(api.meta.connectActions.syncAccount, {
        accountId: other.accounts[0].id,
      })
    ).rejects.toThrow("Meta refused the request: Unsupported get request")
    expect((await f.connection(other.connectionId))?.status).toBe("active")
  })

  test("disconnect keeps the rows, frees the WABA and unsubscribes the app", async () => {
    vi.useFakeTimers()
    const f = await setup()
    const { connectionId, accounts } = await f.manual(f.owner)
    await expect(
      f.outsider.client.mutation(api.meta.connect.disconnect, { connectionId })
    ).rejects.toThrow()
    await f.member.client.mutation(api.meta.connect.disconnect, {
      connectionId,
    })
    expect((await f.accounts()).page).toEqual([])
    expect(await f.count()).toEqual({ total: 0 })
    expect(
      await f.owner.client.query(api.meta.connect.getAccount, {
        id: accounts[0].id,
      })
    ).toBeNull()
    expect(
      await f.owner.client.query(api.meta.connect.listConnections, {
        organizationId: f.owner.team,
      })
    ).toEqual([])
    expect(await f.account(accounts[0].id)).toMatchObject({
      status: "disconnected",
      disconnectedAt: expect.any(Number),
    })
    expect((await f.connection(connectionId))?.status).toBe("disconnected")
    await f.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(graph.to(`/${WABA}/subscribed_apps`, "DELETE")).toEqual([
      expect.objectContaining({ authorization: `Bearer ${MANUAL_TOKEN}` }),
    ])
    await expect(
      f.owner.client.mutation(api.meta.connect.disconnect, { connectionId })
    ).rejects.toThrow("Connection not found")

    // The WABA is free: another team connects it.
    await f.manual(f.outsider)
    expect((await f.accounts(f.outsider)).page).toHaveLength(1)
  })

  test("reconnecting after a disconnect reuses the number's row", async () => {
    const f = await setup()
    const first = await f.manual(f.owner)
    await f.owner.client.mutation(api.meta.connect.disconnect, {
      connectionId: first.connectionId,
    })
    const second = await f.manual(f.owner)
    expect(second.accounts[0].id).toBe(first.accounts[0].id)
    const account = await f.account(first.accounts[0].id)
    expect(account?.status).toBe("pending")
    expect(account).not.toHaveProperty("disconnectedAt")
    expect(await f.count()).toEqual({ total: 1 })
  })

  test("the health cron checks every active connection through the scheduler", async () => {
    vi.useFakeTimers()
    const f = await setup()
    const owner = await f.manual(f.owner)
    const outsider = await f.manual(f.outsider, OTHER_WABA)
    phones["5550003"] = "1060003"
    const gone = await f.manual(f.owner, "5550003")
    await f.owner.client.mutation(api.meta.connect.disconnect, {
      connectionId: gone.connectionId,
    })
    await f.t.finishAllScheduledFunctions(vi.runAllTimers)
    graph.calls.length = 0
    numberFields = { quality_rating: "RED" }
    tokenInfo = {
      granular_scopes: [
        { scope: "whatsapp_business_management", target_ids: [WABA] },
      ],
    }
    await f.t.mutation(internal.meta.connect.dispatchHealthChecks, {})
    await f.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(graph.to("/debug_token")).toHaveLength(2)
    // The owner's token still reaches its WABA; its numbers were synced.
    const checked = await f.connection(owner.connectionId)
    expect(checked?.status).toBe("active")
    expect(checked).not.toHaveProperty("error")
    expect((await f.account(owner.accounts[0].id))?.quality).toBe("red")
    // The outsider's token lost its WABA.
    expect(await f.connection(outsider.connectionId)).toMatchObject({
      status: "error",
      error: "The token has no access to this WhatsApp Business Account",
    })
    expect(graph.to(`/${OTHER_WABA}/phone_numbers`)).toEqual([])
    // Only active connections are checked.
    graph.calls.length = 0
    await f.t.mutation(internal.meta.connect.dispatchHealthChecks, {})
    await f.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(graph.to("/debug_token")).toHaveLength(1)
  })
})
