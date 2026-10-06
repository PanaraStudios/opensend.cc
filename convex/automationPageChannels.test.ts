import { afterEach, beforeEach, expect, test, vi } from "vitest"
import workpoolTest from "@convex-dev/workpool/test"
import { api, internal } from "./_generated/api"
import type { AutomationStep } from "../lib/dashboard/types"
import { PAGE_CHANNELS, CHANNELS, type PageChannel } from "../lib/channels"
import { readGraph } from "./automationDefinition"
import { automationGraph, parseAutomationGraph } from "./api/automationGraph"
import { startRun } from "./automationRuntime"
import { patchRow } from "./counts"
import { upsertContact } from "./audience"
import {
  fakeGraph,
  signedWebhook,
  APP_SECRET,
} from "./testHelpers/meta.fixture"
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PAGE_ID,
  PSID,
  IGSID,
} from "./testHelpers/pages.fixture"

let graph: ReturnType<typeof fakeGraph>
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "automation-page-key-".repeat(4))
  vi.stubEnv("BETTER_AUTH_SECRET", "automation-page-secret-".repeat(4))
  graph = fakeGraph(pageGraphRoutes())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await pagesFixture()
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .take(1000))
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id)
  })
  return f
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function project(f: Fixture, channel: PageChannel) {
  const response = await f.t.fetch(
    "/meta/webhook",
    await signedWebhook(
      APP_SECRET,
      pageEnvelope(channel, {
        message: { mid: `mid.automation.${channel}`, text: "Please reply" },
      })
    )
  )
  expect(response.status).toBe(200)
  const event = (await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  ))!
  await f.t.mutation(internal.meta.projection.project, { id: event._id })
  return (await f.t.run((ctx) =>
    ctx.db
      .query("conversations")
      .withIndex("by_organizationId_and_channel_and_lastMessageAt", (q) =>
        q.eq("organizationId", f.owner.team).eq("channel", channel)
      )
      .first()
  ))!
}
async function template(f: Fixture, channel: PageChannel, publish = true) {
  const id = await f.owner.client.mutation(api.templates.create, {
    organizationId: f.owner.team,
    channel,
    name: `${channel} welcome`,
    content: {
      text: "Hello {{{name}}}",
      quick_replies: [{ title: "Yes", payload: "YES_{{{name}}}" }],
    },
  })
  if (publish) await f.owner.client.mutation(api.templates.publish, { id })
  return id
}
function step(
  f: Fixture,
  channel: PageChannel,
  templateId?: string
): AutomationStep {
  return {
    key: "reply",
    type: CHANNELS[channel].sendStep,
    accountId: f.accounts.find((account) => account.channel === channel)!.id,
    mode: templateId ? "template" : "text",
    ...(templateId ? { templateId } : { text: "Thanks for your message" }),
    variables: templateId
      ? { name: { contact: "firstName", fallback: "friend" } }
      : {},
  }
}
async function automation(
  f: Fixture,
  channel: PageChannel,
  node: AutomationStep
) {
  const id = await f.owner.client.mutation(api.automations.create, {
    organizationId: f.owner.team,
  })
  await f.owner.client.mutation(api.automations.update, {
    organizationId: f.owner.team,
    id,
    trigger: `opensend:${channel}.message.received`,
    graph: JSON.stringify([node]),
  })
  expect(
    await f.owner.client.mutation(api.automations.setStatus, {
      organizationId: f.owner.team,
      id,
      status: "enabled",
    })
  ).toEqual([])
  return (await f.t.run((ctx) => ctx.db.get("automations", id)))!
}
async function tick(f: Fixture) {
  for (let i = 0; i < 30; i++) {
    vi.advanceTimersByTime(100)
    await f.t.finishInProgressScheduledFunctions()
  }
}
for (const channel of PAGE_CHANNELS) {
  test(`${channel} rechecks a queued automation recipient after unsubscribe`, async () => {
    const f = await setup()
    const conversation = await project(f, channel)
    const contact = (await f.t.run((ctx) =>
      ctx.db.get("contacts", conversation.contactId!)
    ))!
    const row = await automation(f, channel, step(f, channel))
    const id = await f.t.run((ctx) => startRun(ctx, row, contact, {}))
    await f.t.mutation(internal.automationRuntime.perform, { id, key: "reply" })
    const message = (
      await f.t.run((ctx) =>
        ctx.db
          .query("channelMessages")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", f.owner.team)
          )
          .collect()
      )
    ).find((m) => m.automationRunId === id)!
    await f.owner.client.mutation(api.contacts.update, {
      id: contact._id,
      unsubscribed: true,
    })
    await f.t.action(internal.channels.deliver.deliver, {
      id: message._id,
      generation: message.generation,
    })
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")).toHaveLength(0)
    expect(
      (await f.t.run((ctx) => ctx.db.get("channelMessages", message._id)))
        ?.status
    ).toBe("failed")
  })
  test(`${channel} inbound system event runs a reply through the shared pipeline`, async () => {
    const f = await setup()
    const templateId =
      channel === "instagram" ? await template(f, channel) : undefined
    const node = step(f, channel, templateId)
    const row = await automation(f, channel, node)
    const conversation = await project(f, channel)
    await tick(f)
    const run = (await f.t.run((ctx) =>
      ctx.db
        .query("automationRuns")
        .withIndex("by_organizationId_and_automationId", (q) =>
          q.eq("organizationId", f.owner.team).eq("automationId", row._id)
        )
        .unique()
    ))!
    expect(run).toMatchObject({
      status: "completed",
      sent: 1,
      contactId: conversation.contactId,
    })
    expect(run.contactEmail).toBeUndefined()
    const sends = graph.to(`/${PAGE_ID}/messages`, "POST")
    expect(sends).toHaveLength(1)
    expect(sends[0].body).toMatchObject({
      recipient: { id: channel === "messenger" ? PSID : IGSID },
      messaging_type: "RESPONSE",
      message:
        channel === "messenger"
          ? { text: "Thanks for your message" }
          : {
              text: "Hello Grace",
              quick_replies: [
                { content_type: "text", title: "Yes", payload: "YES_Grace" },
              ],
            },
    })
    expect(sends[0].body).not.toHaveProperty("tag")
    const message = (
      await f.t.run((ctx) =>
        ctx.db
          .query("channelMessages")
          .withIndex("by_organizationId", (q) =>
            q.eq("organizationId", f.owner.team)
          )
          .take(10)
      )
    ).find((message) => message.direction === "outbound")!
    expect(message).toMatchObject({
      channel,
      source: "automation",
      automationRunId: run._id,
      conversationId: conversation._id,
    })
    if (templateId) expect(message.templateId).toBe(templateId)
  })

  test(`${channel} skips a contact whose identity belongs to another account or team`, async () => {
    const f = await setup()
    const conversation = await project(f, channel)
    const row = await automation(f, channel, step(f, channel))
    await f.t.run(async (ctx) => {
      await ctx.db.patch("channelContacts", conversation.channelContactId!, {
        scopeId: "another-account",
      })
    })
    const contact = (await f.t.run((ctx) =>
      ctx.db.get("contacts", conversation.contactId!)
    ))!
    const id = await f.t.run((ctx) => startRun(ctx, row, contact, {}))
    const run = (await f.t.run((ctx) => ctx.db.get("automationRuns", id)))!
    const effect = () =>
      f.t.mutation(internal.automationRuntime.effect, {
        run,
        node: JSON.stringify(step(f, channel)),
      })
    expect(await effect()).toEqual({
      skipped: true,
      output: { reason: "no_channel_identity" },
    })
    await f.t.run(async (ctx) => {
      const account = (await ctx.db.get(
        "channelAccounts",
        f.accounts.find((a) => a.channel === channel)!.id
      ))!
      await ctx.db.patch("channelContacts", conversation.channelContactId!, {
        scopeId: account.externalId,
        organizationId: f.outsider.team,
      })
    })
    expect(await effect()).toEqual({
      skipped: true,
      output: { reason: "no_channel_identity" },
    })
    const noIdentity = await f.t.run(
      async (ctx) =>
        (
          await upsertContact(
            ctx,
            f.owner.team,
            { email: "no-identity@test.example" },
            { properties: [], segmentIds: [] }
          )
        ).id
    )
    const otherRunId = await f.t.run(async (ctx) =>
      startRun(ctx, row, (await ctx.db.get("contacts", noIdentity))!, {})
    )
    const otherRun = (await f.t.run((ctx) =>
      ctx.db.get("automationRuns", otherRunId)
    ))!
    expect(
      await f.t.mutation(internal.automationRuntime.effect, {
        run: otherRun,
        node: JSON.stringify(step(f, channel)),
      })
    ).toEqual({ skipped: true, output: { reason: "no_channel_identity" } })
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")).toHaveLength(0)
  })

  test(`${channel} skips text and templates at the window boundary`, async () => {
    const f = await setup()
    const conversation = await project(f, channel)
    const templateId = await template(f, channel)
    const row = await automation(f, channel, step(f, channel))
    const id = await f.t.run(async (ctx) =>
      startRun(
        ctx,
        row,
        (await ctx.db.get("contacts", conversation.contactId!))!,
        {}
      )
    )
    const run = (await f.t.run((ctx) => ctx.db.get("automationRuns", id)))!
    for (const windowExpiresAt of [Date.now(), Date.now() - 1]) {
      await f.t.run((ctx) =>
        patchRow(ctx, "conversations", conversation._id, { windowExpiresAt })
      )
      for (const node of [step(f, channel), step(f, channel, templateId)]) {
        expect(
          await f.t.mutation(internal.automationRuntime.effect, {
            run,
            node: JSON.stringify(node),
          })
        ).toEqual({ skipped: true, output: { reason: "window_closed" } })
      }
    }
    await tick(f)
    expect(
      await f.t.run((ctx) => ctx.db.get("automationRuns", id))
    ).toMatchObject({ status: "completed", sent: 0 })
    expect(
      await f.t.run((ctx) =>
        ctx.db
          .query("automationRunSteps")
          .withIndex("by_organizationId_and_runId_and_key", (q) =>
            q
              .eq("organizationId", f.owner.team)
              .eq("runId", id)
              .eq("key", "reply")
          )
          .unique()
      )
    ).toMatchObject({ status: "skipped", output: { reason: "window_closed" } })
    expect(graph.to(`/${PAGE_ID}/messages`, "POST")).toHaveLength(0)
  })

  test(`${channel} graph and REST round trips keep snake_case account/template fields`, async () => {
    const f = await setup()
    const templateId = await template(f, channel)
    const nodes = [
      step(f, channel),
      { ...step(f, channel, templateId), key: "template" },
    ]
    const wire = automationGraph({
      trigger: `opensend:${channel}.message.received`,
      graph: JSON.stringify(nodes),
    })
    expect(wire.steps[1].config).toMatchObject({
      account_id: f.accounts.find((a) => a.channel === channel)!.id,
      mode: "text",
    })
    expect(wire.steps[2].config).toMatchObject({
      template_id: templateId,
      variables: { name: { contact: "firstName", fallback: "friend" } },
    })
    expect(
      readGraph(parseAutomationGraph(wire.steps, wire.connections).graph)
    ).toEqual(nodes)
    const { token } = await f.owner.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: {
        name: "Page automation",
        permission: "full_access",
        domainId: null,
      },
    })
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    }
    const created = await f.t.fetch("/automations", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: channel, status: "enabled", ...wire }),
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const made = await created.json()
    const result = await f.t.fetch(`/automations/${made.id}`, { headers })
    expect(result.status).toBe(200)
    expect((await result.json()).steps).toEqual(wire.steps)
    const node = nodes[0] as Extract<
      AutomationStep,
      { type: "send_messenger" | "send_instagram" }
    >
    const { variables: _variables, ...withoutVariables } = node
    void _variables
    expect(readGraph(JSON.stringify([withoutVariables]))[0]).toEqual(node)
    expect(() =>
      readGraph(JSON.stringify([{ ...node, mode: "invalid" }]))
    ).toThrow("Invalid automation definition")
    expect(() =>
      readGraph(JSON.stringify([{ ...node, accountId: undefined }]))
    ).toThrow("Invalid automation definition")
    expect(() =>
      readGraph(
        JSON.stringify([{ ...node, variables: { x: { contact: "id" } } }])
      )
    ).toThrow("Invalid automation definition")
  })

  test(`${channel} picker and activation enforce team/channel/published template scope`, async () => {
    const f = await setup()
    const published = await template(f, channel)
    const draft = await template(f, channel, false)
    const other = channel === "messenger" ? "instagram" : "messenger"
    const wrongChannel = await template(f, other)
    const accountId = f.accounts.find((a) => a.channel === channel)!.id
    const options = await f.owner.client.query(api.automations.channelOptions, {
      organizationId: f.owner.team,
      channel,
      accountId,
      templateId: wrongChannel,
    })
    expect(options.accounts.map((a) => a.id)).toEqual([accountId])
    expect(options.templates.map((t) => t.id)).toEqual([published])
    expect(options.selected).toBeNull()
    const selected = await f.owner.client.query(
      api.automations.channelOptions,
      {
        organizationId: f.owner.team,
        channel,
        accountId,
        templateId: published,
        templateSearch: "no match",
      }
    )
    expect(selected.selected?.variables).toEqual(["name"])
    for (const templateId of [draft, wrongChannel]) {
      await expect(
        automation(f, channel, step(f, channel, templateId))
      ).rejects.toMatchObject({
        data:
          templateId === draft
            ? "Publish this template before sending it"
            : "Template not found",
      })
    }
    const foreign = await f.outsider.client.mutation(api.templates.create, {
      organizationId: f.outsider.team,
      channel,
      name: "Foreign",
      content: { text: "Hi" },
    })
    await f.outsider.client.mutation(api.templates.publish, { id: foreign })
    await expect(
      automation(f, channel, step(f, channel, foreign))
    ).rejects.toMatchObject({ data: "Template not found" })
    await expect(
      f.outsider.client.query(api.automations.channelOptions, {
        organizationId: f.owner.team,
        channel,
        accountId,
      })
    ).rejects.toBeDefined()
    const missingMapping = { ...step(f, channel, published), variables: {} }
    await expect(automation(f, channel, missingMapping)).rejects.toMatchObject({
      data: "Map every template variable before sending",
    })
    const wrongAccount = {
      ...step(f, channel),
      accountId: f.accounts.find((a) => a.channel === other)!.id,
    }
    await expect(automation(f, channel, wrongAccount)).rejects.toMatchObject({
      data: { statusCode: 404, name: "not_found" },
    })
  })
}
