import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { restart, type WorkflowId } from "@convex-dev/workflow"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { api, components, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { patchRow } from "./counts"
import { receiveEvent } from "./automationEvents"
import { upsertContact } from "./audience"
import { emitEvent } from "./events"
import type { AutomationStep } from "../lib/dashboard/types"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "automation-test-secret-32-characters")
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubEnv("CONVEX_SITE_URL", "https://api.opensend.test")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function setup() {
  const f = await fixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
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
  await storeTestCredentials(f)
  await f.t.run(async (ctx) => {
    // The fixture queues installation provisioning; these tests exercise only
    // the automation and sending pools, never infrastructure or real AWS.
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
    await patchRow(ctx, "domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  const sends: unknown[] = []
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      sends.push(command.input)
      return { MessageId: "ses-automation" } as never
    }
  )
  const organizationId = f.owner.team
  const contactId = await f.t.run(
    async (ctx) =>
      (
        await upsertContact(
          ctx,
          organizationId,
          { email: "person@example.test" },
          { properties: [], segmentIds: [] }
        )
      ).id
  )
  const create = async (steps: AutomationStep[], enabled = true) => {
    const id = await member.client.mutation(api.automations.create, {
      organizationId,
    })
    await member.client.mutation(api.automations.update, {
      organizationId,
      id,
      trigger: "signup",
      graph: JSON.stringify(steps),
    })
    if (enabled)
      expect(
        await member.client.mutation(api.automations.setStatus, {
          organizationId,
          id,
          status: "enabled",
        })
      ).toEqual([])
    return id
  }
  return { ...f, member, organizationId, contactId, create, sends }
}
type Setup = Awaited<ReturnType<typeof setup>>
const update: AutomationStep = {
  key: "update",
  type: "contact_update",
  fields: [{ property: "first_name", action: "change", value: "event.name" }],
}
const delay: AutomationStep = {
  key: "delay",
  type: "delay",
  duration: "1 minute",
}
const wait: AutomationStep = {
  key: "wait",
  type: "wait_for_event",
  eventName: "paid",
  timeout: "1 minute",
  received: [{ ...update, key: "received" }],
  timedOut: [
    {
      key: "timeout",
      type: "contact_update",
      fields: [{ property: "last_name", action: "change", value: "expired" }],
    },
  ],
}
async function testRun(
  f: Setup,
  id: Id<"automations">,
  payload = { name: "Ada" }
) {
  return f.member.client.mutation(api.automations.test, {
    organizationId: f.organizationId,
    id,
    contactId: f.contactId,
    payload,
  })
}
async function tick(f: Setup, ms = 2000) {
  for (let i = 0; i < ms / 100; i++) {
    vi.advanceTimersByTime(100)
    await f.t.finishInProgressScheduledFunctions()
  }
}
const run = (f: Setup, id: Id<"automationRuns">) =>
  f.t.run((ctx) => ctx.db.get("automationRuns", id))
const steps = (f: Setup, runId: Id<"automationRuns">) =>
  f.member.client.query(api.automations.runSteps, {
    organizationId: f.organizationId,
    runId,
  })
const emit = (
  f: Setup,
  name: string,
  email = "person@example.test",
  payload = { name: "Grace" }
) =>
  f.t.run(async (ctx) =>
    receiveEvent(ctx, f.organizationId, { name, contact: null, email, payload })
  )

describe("automations", () => {
  test("members write; other teams cannot read or mutate definitions and runs", async () => {
    const f = await setup()
    const id = await f.create([delay, update])
    const runId = await testRun(f, id)
    await expect(
      f.outsider.client.query(api.automations.list, {
        organizationId: f.organizationId,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow(/permission/i)
    await expect(
      f.outsider.client.mutation(api.automations.update, {
        organizationId: f.organizationId,
        id,
        name: "Stolen",
      })
    ).rejects.toThrow(/permission/i)
    await expect(
      f.outsider.client.mutation(api.automations.cancelRun, {
        organizationId: f.outsider.team,
        runId,
      })
    ).rejects.toThrow(/permission/i)
    await expect(
      f.outsider.client.mutation(api.automations.test, {
        organizationId: f.outsider.team,
        id,
        contactId: f.contactId,
        payload: {},
      })
    ).rejects.toThrow(/permission/i)
    expect(
      (
        await f.member.client.query(api.automations.count, {
          organizationId: f.organizationId,
        })
      ).total
    ).toBe(1)
  })
  test("bounds and validates definitions, enable prerequisites, and event payloads", async () => {
    const f = await setup()
    const id = await f.create([], false)
    for (const graph of [
      "{}",
      '[{"key":"x","type":"unknown"}]',
      JSON.stringify([update, update]),
      JSON.stringify(
        Array.from({ length: 101 }, (_, i) => ({ ...delay, key: `d${i}` }))
      ),
    ])
      await expect(
        f.member.client.mutation(api.automations.update, {
          organizationId: f.organizationId,
          id,
          graph,
        })
      ).rejects.toThrow(/Invalid automation/)
    expect(
      await f.member.client.mutation(api.automations.setStatus, {
        organizationId: f.organizationId,
        id,
        status: "enabled",
      })
    ).not.toEqual([])
    await expect(testRun(f, id)).rejects.toThrow(/Start/)
    await f.member.client.mutation(api.automations.update, {
      organizationId: f.organizationId,
      id,
      graph: JSON.stringify([update]),
    })
    await f.member.client.mutation(api.automations.setStatus, {
      organizationId: f.organizationId,
      id,
      status: "enabled",
    })
    const definition = await f.member.client.query(
      api.automationEvents.byName,
      { organizationId: f.organizationId, name: "signup" }
    )
    await expect(
      f.member.client.mutation(api.automationEvents.update, {
        id: definition!._id,
        name: "renamed",
      })
    ).rejects.toThrow(/cannot be renamed/)

    await f.member.client.mutation(api.automationEvents.update, {
      id: definition!._id,
      schema: [{ key: "amount", type: "number" }],
    })
    await expect(testRun(f, id)).rejects.toThrow(/amount/)
    await expect(
      f.member.client.mutation(api.automations.update, {
        organizationId: f.organizationId,
        id,
        graph: "[]",
      })
    ).rejects.toThrow(/cannot be edited/)
  })
  test("custom trigger creates unknown contacts once and executes branches in order", async () => {
    const f = await setup()
    const id = await f.create([
      {
        key: "branch",
        type: "condition",
        match: "and",
        rules: [{ field: "event.name", operator: "eq", value: "Grace" }],
        met: [update],
        notMet: [{ key: "delete", type: "contact_delete" }],
      },
    ])
    await emit(f, "signup", "new@example.test")
    await tick(f)
    const rows = await f.member.client.query(api.automations.runs, {
      organizationId: f.organizationId,
      id,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(rows.page).toHaveLength(1)
    const row = rows.page[0]!
    expect(row.status).toBe("completed")
    expect((await steps(f, row._id)).map((s) => [s.key, s.status])).toEqual([
      ["branch", "completed"],
      ["start", "completed"],
      ["update", "completed"],
    ])
    expect(
      (await f.t.run((ctx) => ctx.db.get("contacts", row.contactId)))?.firstName
    ).toBe("Grace")
    await f.t.mutation(internal.automationRuntime.consume, { id: row.eventId! })
    await tick(f)
    expect(
      (
        await f.member.client.query(api.automations.runCount, {
          organizationId: f.organizationId,
          id,
        })
      ).total
    ).toBe(1)
  })
  test("system events do not trigger a custom event with the same name", async () => {
    const f = await setup()
    const id = await f.create([update])
    await f.member.client.mutation(api.automations.setStatus, {
      organizationId: f.organizationId,
      id,
      status: "disabled",
    })
    await f.member.client.mutation(api.automations.update, {
      organizationId: f.organizationId,
      id,
      trigger: "contact.updated",
    })
    await f.member.client.mutation(api.automations.setStatus, {
      organizationId: f.organizationId,
      id,
      status: "enabled",
    })
    await f.t.run((ctx) =>
      emitEvent(ctx, f.organizationId, "contact.updated", { id: f.contactId })
    )
    await tick(f)
    expect(
      (
        await f.member.client.query(api.automations.runCount, {
          organizationId: f.organizationId,
          id,
        })
      ).total
    ).toBe(0)
    await emit(f, "contact.updated")
    await tick(f)
    expect(
      (
        await f.member.client.query(api.automations.runCount, {
          organizationId: f.organizationId,
          id,
        })
      ).total
    ).toBe(1)
  })
  test("durable delay resumes after the deadline and survives workflow restart without duplicate effects", async () => {
    const f = await setup()
    const id = await f.create([update, delay, { ...update, key: "after" }])
    const runId = await testRun(f, id)
    await tick(f)
    expect((await run(f, runId))?.status).toBe("running")
    expect((await steps(f, runId)).map((s) => s.key)).not.toContain("after")
    const workflowId = (await run(f, runId))!.workflowId as WorkflowId
    await tick(f, 62_000)
    expect((await run(f, runId))?.status).toBe("completed")
    await f.t.run((ctx) => restart(ctx, components.workflow, workflowId))
    await tick(f)
    expect(await steps(f, runId)).toHaveLength(4)
    const metrics = await f.member.client.query(api.automations.metrics, {
      organizationId: f.organizationId,
      id,
    })
    expect(metrics.total).toBe(1)
    expect(
      metrics.steps.find((s) => s.key === "delay")?.averageMs
    ).toBeGreaterThanOrEqual(60_000)
  })
  test("wait matches only the same contact and keeps trigger payload for subsequent references", async () => {
    const f = await setup()
    const id = await f.create([wait])
    const runId = await testRun(f, id)
    await tick(f)
    await emit(f, "paid", "different@example.test")
    await tick(f)
    expect((await run(f, runId))?.waitingName).toBe("paid")
    await emit(f, "paid")
    await tick(f)
    expect((await run(f, runId))?.status).toBe("completed")
    expect((await steps(f, runId)).map((s) => s.key)).toContain("received")
    expect(
      (await f.t.run((ctx) => ctx.db.get("contacts", f.contactId)))?.firstName
    ).toBe("Ada")
    await tick(f, 62_000)
    expect((await steps(f, runId)).map((s) => s.key)).not.toContain("timeout")
  })
  test("wait timeout takes its timeout branch once", async () => {
    const f = await setup()
    const id = await f.create([wait])
    const runId = await testRun(f, id)
    await tick(f, 64_000)
    expect((await run(f, runId))?.status).toBe("completed")
    expect((await steps(f, runId)).map((s) => s.key)).toContain("timeout")
    await emit(f, "paid")
    await tick(f)
    expect((await steps(f, runId)).map((s) => s.key)).not.toContain("received")
  })
  test("disabling blocks future triggers and lets in-flight snapshots finish", async () => {
    const f = await setup()
    const id = await f.create([delay, update])
    const runId = await testRun(f, id)
    await tick(f)
    await f.member.client.mutation(api.automations.setStatus, {
      organizationId: f.organizationId,
      id,
      status: "disabled",
    })
    await f.member.client.mutation(api.automations.update, {
      organizationId: f.organizationId,
      id,
      graph: JSON.stringify([{ key: "delete", type: "contact_delete" }]),
    })
    await emit(f, "signup")
    await tick(f, 64_000)
    expect((await run(f, runId))?.status).toBe("completed")
    expect(
      (await f.t.run((ctx) => ctx.db.get("contacts", f.contactId)))?.firstName
    ).toBe("Ada")
    expect(
      (
        await f.member.client.query(api.automations.runCount, {
          organizationId: f.organizationId,
          id,
        })
      ).total
    ).toBe(1)
  })
  test("cancel fences waiting steps; deleting removes run history and counters", async () => {
    const f = await setup()
    const id = await f.create([wait])
    const runId = await testRun(f, id)
    await tick(f)
    await f.member.client.mutation(api.automations.cancelRun, {
      organizationId: f.organizationId,
      runId,
    })
    await emit(f, "paid")
    await tick(f, 64_000)
    expect((await run(f, runId))?.status).toBe("cancelled")
    expect((await steps(f, runId)).find((s) => s.key === "wait")?.status).toBe(
      "cancelled"
    )
    await f.member.client.mutation(api.automations.remove, {
      organizationId: f.organizationId,
      id,
    })
    await tick(f)
    expect(await run(f, runId)).toBeNull()
    expect(
      (
        await f.member.client.query(api.automations.count, {
          organizationId: f.organizationId,
        })
      ).total
    ).toBe(0)
  })
  test("audience effects emit webhooks", async () => {
    const f = await setup()
    const segmentId = await f.member.client.mutation(api.segments.create, {
      organizationId: f.organizationId,
      name: "VIP",
    })
    const id = await f.create([
      update,
      { key: "segment", type: "add_to_segment", segmentId },
      { key: "delete", type: "contact_delete" },
    ])
    await testRun(f, id)
    await tick(f)
    const events = await f.t.run((ctx) => ctx.db.query("events").take(100))
    expect(events.filter((e) => e.type === "contact.updated")).toHaveLength(2)
    expect(events.some((e) => e.type === "contact.deleted")).toBe(true)
    expect(
      await f.t.run((ctx) => ctx.db.get("contacts", f.contactId))
    ).toBeNull()
  })
  test("lists paginate and duplication has independent counters and disabled status", async () => {
    const f = await setup()
    const id = await f.create([update])
    const copy = await f.member.client.mutation(api.automations.duplicate, {
      organizationId: f.organizationId,
      id,
    })
    const first = await f.member.client.query(api.automations.list, {
      organizationId: f.organizationId,
      paginationOpts: { numItems: 1, cursor: null },
    })
    const second = await f.member.client.query(api.automations.list, {
      organizationId: f.organizationId,
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    })
    expect(first.page[0]?._id).not.toBe(second.page[0]?._id)
    expect(
      (
        await f.member.client.query(api.automations.get, {
          organizationId: f.organizationId,
          id: copy,
        })
      )?.status
    ).toBe("disabled")
    expect(
      await f.member.client.query(api.automations.usesEvent, {
        organizationId: f.organizationId,
        name: "signup",
      })
    ).toBe(true)
  })
})

async function emailStep(f: Setup): Promise<AutomationStep> {
  const templateId = await f.member.client.mutation(api.templates.create, {
    organizationId: f.organizationId,
    name: "Welcome",
    subject: "Hello {{{name}}}",
    html: '<p>{{{name}}} {{{contact.email}}} {{{contact.first_name}}}</p><a href="{{{OPENSEND_UNSUBSCRIBE_URL}}}">Unsubscribe</a>',
    from: "Sender <sender@mail.example.test>",
    replyTo: "reply@mail.example.test",
  })
  await f.member.client.mutation(api.templates.publish, { id: templateId })
  return {
    key: "send",
    type: "send_email",
    templateId,
    from: "",
    replyTo: "",
    variables: { name: "event.name" },
  }
}
describe("automation sending", () => {
  test("renders templates, fills unsubscribe links, and sends with the team's SES binding", async () => {
    const f = await setup()
    const id = await f.create([update, await emailStep(f)])
    const runId = await testRun(f, id, { name: "<Ada>" })
    await tick(f, 5000)
    expect((await run(f, runId))?.status).toBe("completed")
    expect(f.sends).toHaveLength(1)
    expect(f.sends[0]).toMatchObject({
      TenantName: f.tenantName,
      ConfigurationSetName: "opensend-team-cfg",
    })
    const sent = JSON.stringify(f.sends[0])
    expect(sent).toContain("&lt;Ada&gt;")
    expect(sent).toContain("person@example.test")
    expect(sent).toContain("List-Unsubscribe")
    expect(sent).toContain("https://opensend.test/unsubscribe/")
    expect(sent).not.toContain("OPENSEND_UNSUBSCRIBE_URL")
    const emails = await f.t.run((ctx) => ctx.db.query("emails").take(10))
    expect(emails[0]).toMatchObject({ source: "automation", status: "sent" })
    expect(
      (
        await f.member.client.query(api.automations.metrics, {
          organizationId: f.organizationId,
          id,
        })
      ).sent
    ).toBe(1)
  })
  test.each(["unsubscribed", "deleted", "suppressed"])(
    "respects %s recipients",
    async (kind) => {
      const f = await setup()
      const send = await emailStep(f)
      const prefix: AutomationStep[] =
        kind === "deleted" ? [{ key: "delete", type: "contact_delete" }] : []
      if (kind === "unsubscribed")
        await f.t.run((ctx) =>
          patchRow(ctx, "contacts", f.contactId, { unsubscribed: true })
        )
      if (kind === "suppressed")
        await f.t.mutation(internal.suppressions.record, {
          organizationId: f.organizationId,
          email: "person@example.test",
          reason: "bounced",
        })
      const id = await f.create([...prefix, send])
      const runId = await testRun(f, id)
      await tick(f, 5000)
      expect(f.sends).toHaveLength(0)
      expect((await run(f, runId))?.status).toBe("completed")
      const emails = await f.t.run((ctx) => ctx.db.query("emails").take(10))
      if (kind === "suppressed") expect(emails[0]?.status).toBe("suppressed")
      else {
        expect(emails).toHaveLength(0)
        expect(
          (await steps(f, runId)).find((step) => step.key === "send")?.status
        ).toBe("skipped")
      }
    }
  )
  test.each(["from", "replyTo"])(
    "rejects a %s override outside the team's verified domains",
    async (field) => {
      const f = await setup()
      const send = await emailStep(f)
      const id = await f.create([{ ...send, [field]: "no@unverified.test" }])
      const runId = await testRun(f, id)
      await tick(f)
      expect((await run(f, runId))?.status).toBe("failed")
      expect(
        (await steps(f, runId)).find((step) => step.key === "send")?.status
      ).toBe("failed")
      expect(f.sends).toHaveLength(0)
      expect(
        await f.t.run((ctx) => ctx.db.query("emails").take(10))
      ).toHaveLength(0)
    }
  )
})

describe("automation boundaries", () => {
  test("event fanout and metrics include waiting runs beyond the first server page", async () => {
    const f = await setup()
    const id = await f.create([{ ...wait, received: [], timedOut: [] }])
    const ids = []
    for (let i = 0; i < 25; i++) ids.push(await testRun(f, id))
    await tick(f, 5000)
    expect((await run(f, ids[24]!))?.waitingName).toBe("paid")
    await emit(f, "paid")
    await tick(f, 5000)
    expect(
      (
        await f.member.client.query(api.automations.runCount, {
          organizationId: f.organizationId,
          id,
          status: "completed",
        })
      ).total
    ).toBe(25)
    const metrics = await f.member.client.query(api.automations.metrics, {
      organizationId: f.organizationId,
      id,
    })
    expect(metrics.total).toBe(25)
    expect(metrics.steps.find((s) => s.key === "wait")?.executions).toBe(25)
    expect(metrics.rates.completed).toBe(100)
    const page1 = await f.member.client.query(api.automations.runs, {
      organizationId: f.organizationId,
      id,
      paginationOpts: { numItems: 10, cursor: null },
    })
    const page2 = await f.member.client.query(api.automations.runs, {
      organizationId: f.organizationId,
      id,
      paginationOpts: { numItems: 10, cursor: page1.continueCursor },
    })
    expect(new Set([...page1.page, ...page2.page].map((r) => r._id)).size).toBe(
      20
    )
  })
  test("deleting an active automation fences its delayed effects before cleanup", async () => {
    const f = await setup()
    const id = await f.create([
      delay,
      { key: "delete", type: "contact_delete" },
    ])
    const runId = await testRun(f, id)
    await tick(f)
    await f.member.client.mutation(api.automations.remove, {
      organizationId: f.organizationId,
      id,
    })
    expect(
      await f.t.mutation(internal.automationRuntime.perform, {
        id: runId,
        key: "delete",
      })
    ).toEqual({ stopped: true })
    await tick(f, 64_000)
    expect(await run(f, runId)).toBeNull()
    expect(
      await f.t.run((ctx) => ctx.db.get("contacts", f.contactId))
    ).not.toBeNull()
  })
  test("condition false path and contact state after earlier updates decide the branch", async () => {
    const f = await setup()
    const id = await f.create([
      update,
      {
        key: "branch",
        type: "condition",
        match: "or",
        rules: [
          { field: "contact.first_name", operator: "eq", value: "other" },
        ],
        met: [{ key: "delete", type: "contact_delete" }],
        notMet: [{ ...update, key: "false" }],
      },
    ])
    const runId = await testRun(f, id)
    await tick(f)
    expect((await steps(f, runId)).map((s) => s.key)).toContain("false")
    expect((await steps(f, runId)).map((s) => s.key)).not.toContain("delete")
  })
  test("subscription changes during a delay are checked again at the send step", async () => {
    const f = await setup()
    const id = await f.create([delay, await emailStep(f)])
    const runId = await testRun(f, id)
    await tick(f)
    await f.t.run((ctx) =>
      patchRow(ctx, "contacts", f.contactId, { unsubscribed: true })
    )
    await tick(f, 64_000)
    expect((await steps(f, runId)).find((s) => s.key === "send")?.status).toBe(
      "skipped"
    )
    expect(f.sends).toHaveLength(0)
  })
  test("topic choice emits contact.updated once when the choice changes", async () => {
    const f = await setup()
    const topicId = await f.member.client.mutation(api.topics.create, {
      organizationId: f.organizationId,
      name: "News",
      description: "",
      defaultSubscription: "opt_in",
      visibility: "public",
    })
    for (let i = 0; i < 2; i++)
      await f.member.client.mutation(api.contacts.setTopic, {
        id: f.contactId,
        topicId,
        subscription: "subscribed",
      })
    const events = await f.t.run((ctx) => ctx.db.query("events").take(100))
    expect(events.filter((e) => e.type === "contact.updated")).toHaveLength(1)
  })
})
