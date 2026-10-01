import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { fakeGraph } from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  PSID,
  IGSID,
} from "./testHelpers/pages.fixture"
import { upsertChannelThread } from "./channels/identity"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "username-test-secret-".repeat(4))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

test.each(["messenger", "instagram"] as const)(
  "%s profile lookup persists only supported identity fields and hydrates all contact surfaces",
  async (channel) => {
    const graph = fakeGraph(pageGraphRoutes())
    const f = await pagesFixture()
    const accountId = f.accounts.find((a) => a.channel === channel)!.id
    const externalId = channel === "messenger" ? PSID : IGSID
    const ids = await f.t.run(async (ctx) => {
      const account = await ctx.db.get("channelAccounts", accountId)
      return upsertChannelThread(ctx, account!, {
        externalId,
        at: Date.now(),
        preview: "Hi",
        direction: "inbound",
      })
    })
    // Messenger must ignore even an unexpected username in the provider payload.
    if (channel === "messenger")
      graph.use({
        path: `/${PSID}`,
        respond: () => ({
          first_name: "Ada",
          last_name: "Lovelace",
          username: "ignored",
        }),
      })
    await f.t.action(internal.meta.pageConnectActions.profile, {
      identityId: ids.channelContactId,
      accountId,
    })
    expect(graph.to(`/${externalId}`)[0].query.fields).toBe(
      channel === "messenger"
        ? "first_name,last_name"
        : "name,username,profile_pic"
    )
    const identity = await f.t.run((ctx) =>
      ctx.db.get("channelContacts", ids.channelContactId)
    )
    expect(identity?.profileName).toBe(
      channel === "messenger" ? "Ada Lovelace" : "Grace Hopper"
    )
    expect(identity?.username).toBe(
      channel === "instagram" ? "grace" : undefined
    )
    const expected = {
      channel,
      externalId,
      ...(channel === "instagram" ? { username: "grace" } : {}),
    }
    const list = await f.owner.client.query(api.contacts.list, {
      organizationId: f.owner.team,
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(list.page[0].channelIdentity).toMatchObject(expected)
    expect(
      (await f.owner.client.query(api.contacts.get, { id: ids.contactId }))
        ?.channelIdentity
    ).toMatchObject(expected)
    expect(
      (
        await f.owner.client.query(api.contacts.options, {
          organizationId: f.owner.team,
          selectedId: ids.contactId,
        })
      )[0].channelIdentity
    ).toMatchObject(expected)
    const identities = await f.owner.client.query(api.contacts.identities, {
      id: ids.contactId,
      paginationOpts: { cursor: null, numItems: 10 },
    })
    expect(identities.page[0].identity).toMatchObject(expected)
    expect(identities.page[0].accounts).toEqual([
      {
        id: accountId,
        name: channel === "messenger" ? "Acme Page" : "Acme Instagram",
      },
    ])
    // An identity linked incorrectly to this contact still cannot cross team boundaries.
    await f.t.run((ctx) =>
      ctx.db.insert("channelContacts", {
        organizationId: f.outsider.team,
        channel,
        scopeId: "other",
        externalId: "private",
        contactId: ids.contactId,
        marketingOptOut: false,
      })
    )
    expect(
      (
        await f.owner.client.query(api.contacts.identities, {
          id: ids.contactId,
          paginationOpts: { cursor: null, numItems: 10 },
        })
      ).page
    ).toHaveLength(1)
    await expect(
      f.outsider.client.query(api.contacts.identities, {
        id: ids.contactId,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).rejects.toMatchObject({ data: "You do not have permission" })
  }
)

test("an Instagram username without a profile name stays a handle rather than a CRM name", async () => {
  const graph = fakeGraph(pageGraphRoutes())
  const f = await pagesFixture()
  const accountId = f.accounts.find((a) => a.channel === "instagram")!.id
  const ids = await f.t.run(async (ctx) =>
    upsertChannelThread(
      ctx,
      (await ctx.db.get("channelAccounts", accountId))!,
      {
        externalId: IGSID,
        at: Date.now(),
        preview: "Hello",
        direction: "inbound",
      }
    )
  )
  graph.use({
    path: `/${IGSID}`,
    respond: () => ({ username: "only_username" }),
  })
  await f.t.action(internal.meta.pageConnectActions.profile, {
    identityId: ids.channelContactId,
    accountId,
  })
  const contact = await f.owner.client.query(api.contacts.get, {
    id: ids.contactId,
  })
  expect(contact).toMatchObject({
    firstName: "",
    lastName: "",
    channelIdentity: { username: "only_username" },
  })
})
