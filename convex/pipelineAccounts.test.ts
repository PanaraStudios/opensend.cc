import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { withoutSystemFields } from "convex-helpers"
import { api, internal } from "./_generated/api"
import { deleteRow, insertRow } from "./counts"
import { findChannelAccount } from "./channels/messages"
import {
  inboundFixture,
  incoming,
  fakeGraph,
  APP_SECRET,
  signedWebhook,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
} from "./testHelpers/pages.fixture"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "pipeline-account-test-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test.each(["whatsapp", "messenger", "instagram"] as const)(
  "%s routing and ownership survive twenty historical owners",
  async (channel) => {
    fakeGraph(pageGraphRoutes())
    const f =
      channel === "whatsapp" ? await inboundFixture() : await pagesFixture()
    const originalId =
      "account" in f
        ? f.account
        : f.accounts.find((a) => a.channel === channel)!.id
    const current = await f.t.run(async (ctx) => {
      const original = (await ctx.db.get("channelAccounts", originalId))!
      const fields = withoutSystemFields(original)
      await deleteRow(ctx, "channelAccounts", originalId)
      for (let i = 0; i < 20; i++)
        await insertRow(ctx, "channelAccounts", {
          ...fields,
          organizationId: `former-owner-${i}`,
          status: "disconnected",
          disconnectedAt: Date.now(),
        })
      const id = await insertRow(ctx, "channelAccounts", fields)
      return (await ctx.db.get("channelAccounts", id))!
    })
    expect(
      (
        await f.t.run((ctx) =>
          findChannelAccount(ctx, f.owner.team, current.externalId, channel)
        )
      )?._id
    ).toBe(current._id)
    const payload =
      channel === "whatsapp"
        ? incoming()
        : pageEnvelope(channel, {
            message: { mid: "mid.current-owner", text: "Hello" },
          })
    expect(
      (
        await f.t.fetch(
          "/meta/webhook",
          await signedWebhook(APP_SECRET, payload)
        )
      ).status
    ).toBe(200)
    const event = (await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").first()
    ))!
    await f.t.mutation(internal.meta.projection.project, { id: event._id })
    const messages = await f.t.run((ctx) =>
      ctx.db.query("channelMessages").collect()
    )
    expect(messages).toHaveLength(1)
    expect(messages[0].accountId).toBe(current._id)
    if (channel !== "whatsapp") {
      await expect(
        f.outsider.client.query(internal.meta.connect.checkPages, {
          organizationId: f.outsider.team,
          accounts: [{ channel, externalId: current.externalId }],
        })
      ).rejects.toThrow("already connected to another team")
      const reconnected = await f.owner.client.action(
        api.meta.pageConnectActions.connectPageManual,
        {
          organizationId: f.owner.team,
          pageId: current.pageId!,
          token: "page-reconnect-test-token",
        }
      )
      expect(reconnected.accounts.find((a) => a.channel === channel)?.id).toBe(
        current._id
      )
    }
  }
)

test("disconnect continues past retired Instagram accounts and preserves history", async () => {
  fakeGraph(pageGraphRoutes())
  const f = await pagesFixture()
  const originalId = f.accounts.find((a) => a.channel === "instagram")!.id
  const original = (await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", originalId)
  ))!
  await f.t.run((ctx) => deleteRow(ctx, "channelAccounts", originalId))
  for (let start = 0; start < 500; start += 100)
    await f.t.run(async (ctx) => {
      for (let i = start; i < start + 100; i++)
        await insertRow(ctx, "channelAccounts", {
          ...withoutSystemFields(original),
          externalId: `retired-instagram-${i}`,
          status: "disconnected",
          disconnectedAt: Date.now(),
        })
    })
  const currentId = await f.t.run((ctx) =>
    insertRow(ctx, "channelAccounts", withoutSystemFields(original))
  )
  await f.owner.client.mutation(api.meta.connect.disconnect, {
    connectionId: original.connectionId,
  })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(
    await f.t.run((ctx) => ctx.db.get("channelAccounts", currentId))
  ).toMatchObject({ status: "disconnected" })
  const accounts = await f.t.run((ctx) =>
    ctx.db
      .query("channelAccounts")
      .withIndex("by_connectionId", (q) =>
        q.eq("connectionId", original.connectionId)
      )
      .collect()
  )
  expect(accounts).toHaveLength(502)
  expect(accounts.every((row) => row.disconnectedAt !== undefined)).toBe(true)
})

test("disconnect frees every WABA past the first hundred", async () => {
  fakeGraph([
    { path: /\/subscribed_apps$/, respond: () => ({ success: true }) },
  ])
  const f = await inboundFixture()
  const account = (await f.t.run((ctx) =>
    ctx.db.get("channelAccounts", f.account)
  ))!
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 100; i++)
      await ctx.db.insert("whatsappBusinessAccounts", {
        organizationId: f.owner.team,
        connectionId: account.connectionId,
        wabaId: `additional-waba-${i}`,
      })
  })
  await f.owner.client.mutation(api.meta.connect.disconnect, {
    connectionId: account.connectionId,
  })
  await f.t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("whatsappBusinessAccounts")
        .withIndex("by_connectionId", (q) =>
          q.eq("connectionId", account.connectionId)
        )
        .collect()
    )
  ).toEqual([])
})
