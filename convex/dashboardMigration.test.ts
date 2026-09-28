import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, components } from "./_generated/api"
import { insertRow, patchRow } from "./counts"
import { fixture } from "./testHelpers/ses.fixture"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function setup() {
  const f = await fixture()
  const member = await f.actor("member")
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
  return { ...f, member }
}

describe("dashboard domain lookups", () => {
  test("reads the exact team domain beyond the dropdown page, normalizing its name", async () => {
    const f = await setup()
    await f.t.run(async (ctx) => {
      const domain = (await ctx.db.get("domains", f.domain))!
      const { _id, _creationTime, ...fields } = domain
      void _id
      void _creationTime
      for (let i = 0; i < 105; i++)
        await insertRow(ctx, "domains", {
          ...fields,
          name: `a${i}.example.test`,
        })
    })
    const first = await f.member.client.query(api.domains.list, {
      organizationId: f.owner.team,
      paginationOpts: { numItems: 100, cursor: null },
    })
    expect(first.page.some((row) => row._id === f.domain)).toBe(false)
    const domain = await f.member.client.query(api.domains.byName, {
      organizationId: f.owner.team,
      name: " MAIL.EXAMPLE.TEST ",
    })
    expect(domain?._id).toBe(f.domain)
  })

  test("refuses another team's member and excludes deleted domains", async () => {
    const f = await setup()
    const args = { organizationId: f.owner.team, name: "mail.example.test" }
    await expect(
      f.outsider.client.query(api.domains.byName, args)
    ).rejects.toThrow(/permission/i)
    await f.t.run((ctx) =>
      patchRow(ctx, "domains", f.domain, { deleted: true })
    )
    expect(await f.member.client.query(api.domains.byName, args)).toBeNull()
  })
})

describe("automation reference lookups", () => {
  test("a member writes product data and resolves a selected template older than 100 options", async () => {
    const f = await setup()
    const organizationId = f.owner.team
    const segment = await f.member.client.mutation(api.segments.create, {
      organizationId,
      name: "Customers",
    })
    const template = await f.member.client.mutation(api.templates.create, {
      organizationId,
      name: "Original",
    })
    await f.t.run(async (ctx) => {
      const row = (await ctx.db.get("templates", template))!
      const { _id, _creationTime, ...fields } = row
      void _id
      void _creationTime
      for (let i = 0; i < 101; i++)
        await insertRow(ctx, "templates", { ...fields, name: `New ${i}` })
    })
    const options = await f.member.client.query(api.templates.options, {
      organizationId,
    })
    expect(options.some((row) => row._id === template)).toBe(false)
    const context = await f.member.client.query(api.automations.stepContext, {
      organizationId,
      templateIds: [template, template],
      segmentIds: [segment],
    })
    expect(context).toEqual({
      templates: [{ id: template, name: "Original", status: "draft" }],
      segments: [{ id: segment, name: "Customers" }],
    })
  })

  test("refuses team impersonation and never exposes foreign or missing references", async () => {
    const f = await setup()
    const id = await f.outsider.client.mutation(api.templates.create, {
      organizationId: f.outsider.team,
      name: "Private",
    })
    const args = {
      organizationId: f.owner.team,
      templateIds: [id, "missing"],
      segmentIds: ["missing"],
    }
    await expect(
      f.outsider.client.query(api.automations.stepContext, args)
    ).rejects.toThrow(/permission/i)
    expect(
      await f.member.client.query(api.automations.stepContext, args)
    ).toEqual({ templates: [], segments: [] })
  })

  test("rejects oversized reference batches", async () => {
    const f = await setup()
    await expect(
      f.member.client.query(api.automations.stepContext, {
        organizationId: f.owner.team,
        templateIds: Array(101).fill("missing"),
        segmentIds: [],
      })
    ).rejects.toThrow("Too many step references")
  })
})

describe("workspace cursor lists", () => {
  test("pages the signed-in account's teams without exposing another account's teams", async () => {
    const f = await setup()
    const first = await f.member.client.query(api.teams.list, {
      paginationOpts: { numItems: 1, cursor: null },
    })
    const second = await f.member.client.query(api.teams.list, {
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    })
    expect(first.page).toHaveLength(1)
    expect(first.isDone).toBe(false)
    expect(second.isDone).toBe(true)
    expect(
      new Set([...first.page, ...second.page].map((row) => row.id))
    ).toEqual(new Set([f.owner.team, f.member.team]))
  })

  test("pages members with roles, MFA and current-user identity; refuses outsiders", async () => {
    const f = await setup()
    const args = {
      organizationId: f.owner.team,
      paginationOpts: { numItems: 1, cursor: null },
    }
    await expect(
      f.outsider.client.query(api.teams.members, args)
    ).rejects.toThrow(/permission/i)
    const first = await f.member.client.query(api.teams.members, args)
    const second = await f.member.client.query(api.teams.members, {
      ...args,
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    })
    expect(first.page[0]).toMatchObject({
      email: f.owner.user.email,
      role: "admin",
      you: false,
    })
    expect(second.page[0]).toMatchObject({
      email: f.member.user.email,
      role: "member",
      you: true,
      mfa: false,
    })
    expect(second.isDone).toBe(true)
  })
})

test("invitation pages preserve expired labels, skip canceled rows and require a team admin", async () => {
  const f = await setup()
  for (const [status, expiresAt] of [
    ["canceled", Date.now() + 3600000],
    ["pending", Date.now() - 1],
    ["pending", Date.now() + 3600000],
  ] as const) {
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "invitation",
        data: {
          organizationId: f.owner.team,
          email: `${status}-${expiresAt}@example.test`,
          role: "member",
          status,
          expiresAt,
          inviterId: f.owner.user._id,
          createdAt: Date.now(),
        },
      },
    })
  }
  const args = {
    organizationId: f.owner.team,
    paginationOpts: { numItems: 1, cursor: null },
  }
  await expect(
    f.member.client.query(api.teams.invitations, args)
  ).rejects.toThrow(/permission/i)
  await expect(
    f.outsider.client.query(api.teams.invitations, args)
  ).rejects.toThrow(/permission/i)
  const canceled = await f.owner.client.query(api.teams.invitations, args)
  expect(canceled.page).toEqual([])
  expect(canceled.isDone).toBe(false)
  const expired = await f.owner.client.query(api.teams.invitations, {
    ...args,
    paginationOpts: { numItems: 1, cursor: canceled.continueCursor },
  })
  expect(expired.page[0]?.status).toBe("expired")
  const pending = await f.owner.client.query(api.teams.invitations, {
    ...args,
    paginationOpts: { numItems: 1, cursor: expired.continueCursor },
  })
  expect(pending.page[0]?.status).toBe("pending")
  expect(pending.isDone).toBe(true)
})

test("domain name lookup skips tombstones and accepts the same live name in multiple regions", async () => {
  const f = await setup()
  const live = await f.t.run(async (ctx) => {
    const row = (await ctx.db.get("domains", f.domain))!
    const { _id, _creationTime, ...fields } = row
    void _id
    void _creationTime
    await patchRow(ctx, "domains", f.domain, { deleted: true })
    const id = await insertRow(ctx, "domains", fields)
    await insertRow(ctx, "domains", { ...fields, region: "eu-west-1" })
    return id
  })
  expect(
    (
      await f.member.client.query(api.domains.byName, {
        organizationId: f.owner.team,
        name: "mail.example.test",
      })
    )?._id
  ).toBe(live)
})
