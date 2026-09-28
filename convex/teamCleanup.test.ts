import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import type { Id, TableNames } from "./_generated/dataModel"
import { fixture } from "./testHelpers/ses.fixture"
import schema from "./schema"
import authSchema from "./betterAuth/schema"
import { TEAM_TABLES, CHILD_TABLES } from "./teamCleanup"
import { ORGANIZATION_TABLES } from "./betterAuth/teams"
import { counters, insertRow, patchRow } from "./counts"
import { startRun } from "./automationRuntime"
import type { ValidatorJSON } from "convex/values"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

test("every organizationId table in both schemas is covered by retirement", () => {
  const scoped = (tables: typeof schema.tables | typeof authSchema.tables) =>
    Object.entries(tables)
      .filter(
        ([, table]) =>
          table.validator.json.type === "object" &&
          "organizationId" in table.validator.json.value
      )
      .map(([name]) => name)
      .sort()
  expect([...TEAM_TABLES].sort()).toEqual(scoped(schema.tables))
  expect([...ORGANIZATION_TABLES].sort()).toEqual(scoped(authSchema.tables))
})

test("retirement erases every product table and child, preserving other teams and counts", async () => {
  const f = await fixture()
  const ids = await f.t.run(async (ctx) => {
    const ids = new Map<string, string>([
      ["domains", f.domain],
      ["sesTenants", f.tenant],
    ])
    const make = async (table: TableNames): Promise<string> => {
      if (ids.has(table)) return ids.get(table)!
      if ((table as string) === "_storage")
        return ctx.storage.store(new Blob(["stored MIME"]))
      const id = await ctx.db.insert(
        table,
        (await value(
          (schema.tables[table].validator as unknown as { json: ValidatorJSON })
            .json
        )) as never
      )
      ids.set(table, id)
      return id
    }
    const value = async (validator: ValidatorJSON): Promise<unknown> => {
      switch (validator.type) {
        case "object": {
          const out: Record<string, unknown> = {}
          for (const [key, field] of Object.entries(validator.value))
            if (!field.optional)
              out[key] =
                key === "organizationId"
                  ? f.owner.team
                  : await value(field.fieldType)
          return out
        }
        case "id":
          return make(validator.tableName as TableNames)
        case "union":
          return value(validator.value[0])
        case "literal":
          return validator.value
        case "array":
          return []
        case "record":
          return {}
        case "number":
          return 0
        case "boolean":
          return false
        case "string":
          return "test"
        default:
          return null
      }
    }
    for (const table of [...TEAM_TABLES, ...CHILD_TABLES]) await make(table)
    await patchRow(ctx, "domains", f.domain, { deleted: true })
    await ctx.db.patch("sesTenants", f.tenant, { deleted: true })
    // Force child cleanup through more than one transaction.
    for (let n = 0; n < 20; n++)
      await ctx.db.insert("emailEvents", {
        emailId: ids.get("emails") as Id<"emails">,
        type: "sent",
        at: n,
      })
    await insertRow(ctx, "contacts", {
      organizationId: f.owner.team,
      email: "counted@example.com",
      firstName: "",
      lastName: "",
      unsubscribed: false,
      properties: {},
      updatedAt: Date.now(),
      search: "counted",
    })
    await insertRow(ctx, "contacts", {
      organizationId: f.outsider.team,
      email: "safe@example.com",
      firstName: "",
      lastName: "",
      unsubscribed: false,
      properties: {},
      updatedAt: Date.now(),
      search: "safe",
    })
    const storageId = await ctx.storage.store(new Blob(["private attachment"]))
    await ctx.db.patch(
      "emailContents",
      ids.get("emailContents") as Id<"emailContents">,
      {
        attachments: [
          {
            storageId,
            filename: "private.txt",
            contentType: "text/plain",
            size: 18,
          },
        ],
      }
    )
    const exportStorage = await ctx.storage.store(new Blob(["private export"]))
    await ctx.db.patch("exports", ids.get("exports") as Id<"exports">, {
      storageId: exportStorage,
    })
    return { storageId, exportStorage }
  })
  await f.owner.client.mutation(api.teams.remove, {
    organizationId: f.owner.team,
    leave: false,
  })
  await expect(
    f.t.run((ctx) =>
      insertRow(ctx, "contacts", {
        organizationId: f.owner.team,
        email: "late@example.com",
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        updatedAt: Date.now(),
        search: "late",
      })
    )
  ).rejects.toThrow("Team not found")
  await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
  await f.t.run(async (ctx) => {
    for (const table of TEAM_TABLES)
      expect(
        await ctx.db
          .query(table)
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", f.owner.team)
          )
          .collect(),
        table
      ).toEqual([])
    for (const table of CHILD_TABLES)
      expect(await ctx.db.query(table).collect(), table).toEqual([])
    expect(await counters.contacts.total(ctx, f.owner.team)).toBe(0)
    expect(await counters.contacts.total(ctx, f.outsider.team)).toBe(1)
    expect(await ctx.storage.get(ids.storageId)).toBeNull()
    expect(await ctx.storage.get(ids.exportStorage)).toBeNull()
  })
})

test("team deletion rejects outsiders and members, and still requires domains to be removed", async () => {
  const f = await fixture()
  await expect(
    f.outsider.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
  ).rejects.toThrow("permission")
  await expect(
    f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
  ).rejects.toThrow("sending domains")
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
  await expect(
    member.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
  ).rejects.toThrow("permission")
  await member.client.mutation(api.teams.remove, {
    organizationId: f.owner.team,
    leave: true,
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("teamRetirements").collect())
  ).toEqual([])
})

test("SES cleanup failures retain retry state, successful removal erases it", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    await ctx.db.insert("teamRetirements", { teamId: f.owner.team })
    await ctx.db.patch("sesTenants", f.tenant, {
      phase: "running",
      operation: "remove",
      generation: 10,
    })
  })
  await f.t.mutation(internal.tenants.finish, {
    id: f.tenant,
    generation: 10,
    error: "AWS unavailable",
  })
  expect(await f.t.query(internal.tenants.get, { id: f.tenant })).toMatchObject(
    { phase: "failed", operation: "remove" }
  )
  await f.t.run((ctx) =>
    ctx.db.patch("sesTenants", f.tenant, { phase: "running", generation: 11 })
  )
  await f.t.mutation(internal.tenants.finish, {
    id: f.tenant,
    generation: 10,
    removed: true,
  })
  expect(await f.t.query(internal.tenants.get, { id: f.tenant })).not.toBeNull()
  await f.t.mutation(internal.tenants.finish, {
    id: f.tenant,
    generation: 11,
    removed: true,
  })
  expect(await f.t.query(internal.tenants.get, { id: f.tenant })).toBeNull()
})

test("cleanup requires a retirement record and rejects invalid batch cursors", async () => {
  const f = await fixture()
  await f.t.mutation(internal.teamCleanup.purge, {
    organizationId: f.owner.team,
    table: 0,
  })
  expect(await f.t.run((ctx) => ctx.db.get("domains", f.domain))).not.toBeNull()
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
  await expect(
    f.t.mutation(internal.teamCleanup.purge, {
      organizationId: f.owner.team,
      table: -1,
    })
  ).rejects.toThrow("Invalid retirement table")
})

test.each([false, true])(
  "retirement cleans automation workflows (already completed: %s)",
  async (completed) => {
    const f = await fixture()
    const runId = await f.t.run(async (ctx) => {
      await patchRow(ctx, "domains", f.domain, { deleted: true })
      await ctx.db.patch("sesTenants", f.tenant, { deleted: true })
      const contactId = await insertRow(ctx, "contacts", {
        organizationId: f.owner.team,
        email: "queued@example.com",
        firstName: "",
        lastName: "",
        unsubscribed: false,
        properties: {},
        updatedAt: 0,
        search: "queued",
      })
      const id = await insertRow(ctx, "automations", {
        organizationId: f.owner.team,
        name: "queued",
        status: "enabled",
        trigger: "signup",
        graph: JSON.stringify(
          completed ? [] : [{ key: "delay", type: "delay", duration: "1 day" }]
        ),
        deleted: false,
        updatedAt: 0,
      })
      return startRun(
        ctx,
        (await ctx.db.get("automations", id))!,
        (await ctx.db.get("contacts", contactId))!,
        {}
      )
    })
    const workflowId = await f.t.run(
      async (ctx) => (await ctx.db.get("automationRuns", runId))!.workflowId!
    )
    if (completed)
      await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    await f.owner.client.mutation(api.teams.remove, {
      organizationId: f.owner.team,
      leave: false,
    })
    expect(
      await f.t.mutation(internal.automationRuntime.perform, {
        id: runId,
        key: "delay",
      })
    ).toEqual({ stopped: true })
    await f.t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(1000))
    expect(
      await f.t.run((ctx) => ctx.db.get("automationRuns", runId))
    ).toBeNull()
    await expect(
      f.t.query(components.workflow.workflow.getStatus, { workflowId })
    ).rejects.toThrow("Workflow not found")
  }
)
