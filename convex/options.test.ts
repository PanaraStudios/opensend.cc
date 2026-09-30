import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { FunctionReference } from "convex/server"
import { api, components } from "./_generated/api"
import { insertRow } from "./counts"
import { fixture } from "./testHelpers/ses.fixture"

const cases = [
  ["contacts", api.contacts.options],
  ["emails", api.emails.options],
  ["segments", api.segments.options],
  ["topics", api.topics.options],
  ["contactProperties", api.contactProperties.options],
  ["templates", api.templates.options],
  ["automationEvents", api.automationEvents.options],
  ["domains", api.domains.options],
  ["domains", api.metrics.domainOptions],
] as const

type Table = (typeof cases)[number][0]
type Fixture = Awaited<ReturnType<typeof fixture>>

async function seed(
  f: Fixture,
  table: Table,
  organizationId: string,
  name: string
) {
  return f.t.run(async (ctx) => {
    switch (table) {
      case "emails":
        return insertRow(ctx, table, {
          organizationId,
          domainId: f.domain,
          from: "sender@example.test",
          to: ["recipient@example.test"],
          subject: name,
          search: name,
          status: "sent",
          source: "api",
          generation: 1,
          attempts: 1,
        })
      case "contacts":
        return insertRow(ctx, table, {
          organizationId,
          email: `${name}@example.test`,
          firstName: name,
          lastName: "",
          properties: {},
          unsubscribed: false,
          search: `${name}@example.test ${name}`,
          updatedAt: Date.now(),
        })
      case "segments":
        return insertRow(ctx, table, { organizationId, name })
      case "topics":
        return insertRow(ctx, table, {
          organizationId,
          name,
          description: "",
          defaultSubscription: "opt_in",
          visibility: "public",
        })
      case "contactProperties":
        return insertRow(ctx, table, {
          organizationId,
          name,
          key: name,
          type: "string",
        })
      case "templates":
        return insertRow(ctx, table, {
          organizationId,
          name,
          alias: name,
          status: "draft",
          subject: "",
          preview: "",
          variables: [],
          searchText: name,
          updatedAt: Date.now(),
        })
      case "automationEvents":
        return ctx.db.insert(table, {
          organizationId,
          name,
          schema: [],
          searchText: name,
          updatedAt: Date.now(),
        })
      case "domains":
        return insertRow(ctx, table, {
          organizationId,
          name: `${name}.test`,
          region: "us-east-1",
          customReturnPath: "send",
          status: "verified",
          phase: "ready",
          deleted: false,
          sending: true,
          tls: "opportunistic",
          records: [],
          sesVerified: true,
          dkimVerified: true,
          mailFromVerified: true,
          operation: "provision",
        })
    }
  })
}

beforeEach(() => vi.useFakeTimers({ now: new Date("2026-09-29T00:00:00Z") }))
afterEach(() => vi.useRealTimers())

describe("bounded server picker suggestions", () => {
  test.each(cases)(
    "%s options cap, search, selection, validation and team isolation (%#)",
    async (table, reference) => {
      const f = await fixture()
      const old = await seed(f, table, f.owner.team, "needle")
      for (let i = 0; i < 25; i++) {
        vi.setSystemTime(Date.now() + 1)
        await seed(f, table, f.owner.team, `filler${i}`)
      }
      const foreign = await seed(f, table, f.outsider.team, "foreignneedle")
      const query: FunctionReference<"query", "public"> = reference
      const args = { organizationId: f.owner.team }
      const first: unknown[] = await f.owner.client.query(query, args)
      expect(first).toHaveLength(20)
      expect(JSON.stringify(first)).not.toContain("needle")
      expect(JSON.stringify(first[0])).toContain("filler24")
      const found: unknown[] = await f.owner.client.query(query, {
        ...args,
        search: "needle",
      })
      expect(found).toHaveLength(1)
      expect(JSON.stringify(found)).toContain("needle")
      expect(JSON.stringify(found)).not.toContain("foreignneedle")
      const selected: unknown[] = await f.owner.client.query(query, {
        ...args,
        selectedId: old,
      })
      expect(selected).toHaveLength(20)
      expect(JSON.stringify(selected)).toContain("needle")
      const searched: unknown[] = await f.owner.client.query(query, {
        ...args,
        search: "filler",
        selectedId: old,
      })
      expect(searched).toHaveLength(20)
      expect(JSON.stringify(searched)).toContain("needle")
      const foreignSelection: unknown[] = await f.owner.client.query(query, {
        ...args,
        selectedId: foreign,
      })
      expect(JSON.stringify(foreignSelection)).not.toContain("foreignneedle")
      await expect(f.outsider.client.query(query, args)).rejects.toThrow(
        "permission"
      )
      await expect(
        f.owner.client.query(query, { ...args, search: 123 })
      ).rejects.toThrow()
      await expect(
        f.owner.client.query(query, { ...args, selectedId: "bad-id" })
      ).rejects.toThrow()
      await f.t.run((ctx) => ctx.db.delete(table, old))
      expect(
        JSON.stringify(
          await f.owner.client.query(query, { ...args, selectedId: old })
        )
      ).not.toContain("needle")
    }
  )

  test("a plain member can create and find a segment", async () => {
    const f = await fixture()
    await f.t.mutation(components.betterAuth.teams.invite, {
      sessionId: f.owner.session._id,
      organizationId: f.owner.team,
      email: f.outsider.user.email,
      role: "member",
    })
    const snapshot = await f.outsider.client.query(api.teams.snapshot)
    await f.outsider.client.mutation(api.teams.respond, {
      invitationId: snapshot!.receivedInvitations[0].id,
      accept: true,
    })
    const id = await f.outsider.client.mutation(api.segments.create, {
      organizationId: f.owner.team,
      name: "Members can write",
    })
    expect(
      await f.outsider.client.query(api.segments.options, {
        organizationId: f.owner.team,
        selectedId: id,
      })
    ).toMatchObject([{ _id: id }])
  })

  test("deleted domains remain available only to historical metrics; status filters also apply to selections", async () => {
    const f = await fixture()
    const id = await seed(f, "domains", f.owner.team, "needle")
    const args = {
      organizationId: f.owner.team,
      search: "needle",
      selectedId: id as typeof f.domain,
    }
    await f.t.run((ctx) =>
      ctx.db.patch("domains", args.selectedId, { deleted: true })
    )
    expect(await f.owner.client.query(api.domains.options, args)).toEqual([])
    expect(
      await f.owner.client.query(api.metrics.domainOptions, args)
    ).toHaveLength(1)
    await f.t.run((ctx) =>
      ctx.db.patch("domains", args.selectedId, {
        deleted: false,
        status: "pending",
      })
    )
    expect(
      await f.owner.client.query(api.domains.options, {
        ...args,
        status: "verified",
      })
    ).toEqual([])
  })

  test("event names resolve selected values independently of search", async () => {
    const f = await fixture()
    await seed(f, "automationEvents", f.owner.team, "needle")
    await seed(f, "automationEvents", f.outsider.team, "foreignneedle")
    expect(
      await f.owner.client.query(api.automationEvents.options, {
        organizationId: f.owner.team,
        search: "missing",
        selectedName: "needle",
      })
    ).toEqual(["needle"])
    expect(
      await f.owner.client.query(api.automationEvents.options, {
        organizationId: f.owner.team,
        selectedName: "foreignneedle",
      })
    ).toEqual(["needle"])
  })

  test("deleting properties are hidden from suggestions and selected lookup", async () => {
    const f = await fixture()
    const id = await f.t.run((ctx) =>
      insertRow(ctx, "contactProperties", {
        organizationId: f.owner.team,
        key: "hidden",
        name: "Hidden",
        type: "string",
        deleting: true,
      })
    )
    expect(
      await f.owner.client.query(api.contactProperties.options, {
        organizationId: f.owner.team,
        selectedId: id,
        search: "hidden",
      })
    ).toEqual([])
  })

  test("cleanup pages reach tenants beyond the old 25-row cap and require installation admin", async () => {
    const f = await fixture()
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 26; i++)
        await ctx.db.insert("sesTenants", {
          organizationId: f.owner.team,
          name: `cleanup${i}`,
          region: "us-east-1",
          phase: "failed",
          operation: "remove",
          generation: 1,
          deleted: false,
        })
    })
    const first = await f.owner.client.query(api.tenants.cleanup, {
      paginationOpts: { cursor: null, numItems: 20 },
    })
    expect(first.page).toHaveLength(20)
    expect(first.isDone).toBe(false)
    const second = await f.owner.client.query(api.tenants.cleanup, {
      paginationOpts: { cursor: first.continueCursor, numItems: 20 },
    })
    expect(second.page).toHaveLength(6)
    expect(second.isDone).toBe(true)
    expect(
      new Set([...first.page, ...second.page].map((row) => row._id)).size
    ).toBe(26)
    await expect(
      f.outsider.client.query(api.tenants.cleanup, {
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).rejects.toThrow()
  })
})

test("installation sender suggestions cap, search and retain an eligible selection; ordinary members are denied", async () => {
  const f = await fixture()
  const old = (await seed(
    f,
    "domains",
    f.owner.team,
    "needle"
  )) as typeof f.domain
  for (let i = 0; i < 25; i++) {
    vi.setSystemTime(Date.now() + 1)
    await seed(f, "domains", f.owner.team, `filler${i}`)
  }
  const first = await f.owner.client.query(api.systemEmail.domains, {})
  expect(first).toHaveLength(20)
  expect(first[0].name).toBe("filler24.test")
  expect(
    await f.owner.client.query(api.systemEmail.domains, { search: "needle" })
  ).toMatchObject([{ _id: old }])
  const selected = await f.owner.client.query(api.systemEmail.domains, {
    selectedId: old,
  })
  expect(selected).toHaveLength(20)
  expect(selected.some((row) => row._id === old)).toBe(true)
  await expect(
    f.outsider.client.query(api.systemEmail.domains, {})
  ).rejects.toThrow()
  await f.t.run((ctx) => ctx.db.patch("domains", old, { sending: false }))
  expect(
    await f.owner.client.query(api.systemEmail.domains, {
      search: "needle",
      selectedId: old,
    })
  ).toEqual([])
})
