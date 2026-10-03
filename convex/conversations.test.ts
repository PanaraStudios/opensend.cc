/// <reference types="vite/client" />
import {
  pagesFixture,
  pageGraphRoutes,
  pageEnvelope,
  PAGE_ID,
  PSID,
  IGSID,
} from "./testHelpers/pages.fixture"
import workpoolTest from "@convex-dev/workpool/test"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { Id, Doc } from "./_generated/dataModel"
import { api, internal } from "./_generated/api"
import {
  APP_SECRET,
  SENDER,
  WABA_ID,
  PHONE_ID,
  fakeGraph,
  inboundFixture,
  incoming,
  signedWebhook,
} from "./testHelpers/meta.fixture"
import { createChannelMessage } from "./channels/messages"
import { insertRow, patchRow } from "./counts"
import { WHATSAPP_WINDOW_CLOSED as WINDOW_CLOSED } from "../lib/meta/payloads"
import { storeUpload } from "./testHelpers/storage.fixture"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
  vi.stubEnv("BETTER_AUTH_SECRET", "conversations-test-secret-32-bytes!!")
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const page = { cursor: null, numItems: 20 }
type Fixture = Awaited<ReturnType<typeof setup>>

async function setup() {
  const f = await inboundFixture()
  workpoolTest.register(f.t, "sendPool")
  workpoolTest.register(f.t, "webhookPool")
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "channelAccounts", f.account, {
      registeredAt: Date.now(),
    })
    await ctx.db.patch("domains", f.domain, {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-team-cfg",
      receiving: true,
    })
    await ctx.db.patch("sesRegions", f.region._id, {
      callbackConfirmed: true,
      quota: { ...f.region.quota, production: true, rate: 10 },
    })
  })
  const team = f.owner.team
  const list = (filters: Record<string, unknown> = {}) =>
    f.member.client.query(api.conversations.list, {
      organizationId: team,
      paginationOpts: page,
      ...filters,
    })
  return { ...f, team, list }
}

/** A signed WhatsApp webhook, projected at once. */
async function project(f: Fixture, body: unknown) {
  expect(
    (await f.t.fetch("/meta/webhook", await signedWebhook(APP_SECRET, body)))
      .status
  ).toBe(200)
  const event = await f.t.run((ctx) =>
    ctx.db.query("metaWebhookEvents").order("desc").first()
  )
  await f.t.mutation(internal.meta.projection.project, { id: event!._id })
}

/** A parsed inbound email, as receiving stores it. */
async function receive(
  f: Fixture,
  from = "Ada Lovelace <ada@example.com>",
  subject = "Order question"
) {
  const address = from.replace(/^.*<|>$/g, "").toLowerCase()
  return f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob(["raw"]))
    const id = await ctx.db.insert("inboundMessages", {
      organizationId: f.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: crypto.randomUUID(),
      sesMessageId: crypto.randomUUID(),
      bucket: "inbound-bucket",
      objectKey: crypto.randomUUID(),
      storageId,
      notification: JSON.stringify({ receipt: {} }),
    })
    return ctx.runMutation(internal.received.complete, {
      id,
      metadata: {
        from,
        sender: address,
        to: ["Support <support@mail.example.test>"],
        cc: [],
        bcc: [],
        replyTo: [],
        subject,
        messageId: "<question@example.com>",
      },
      content: { html: "", text: "Where is my order?", headers: {} },
      attachments: [],
    })
  })
}

/** Closes WhatsApp's customer service window, as 24 quiet hours would. */
const expire = (f: Fixture, id: Id<"conversations">) =>
  f.t.run((ctx) =>
    patchRow(ctx, "conversations", id, { windowExpiresAt: Date.now() - 1 })
  )

async function thread(f: Fixture, channel: "whatsapp" | "email") {
  const { page } = await f.list({ channel })
  expect(page).toHaveLength(1)
  return page[0].conversation._id
}

async function approvedTemplate(f: Fixture) {
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.team,
    wabaId: WABA_ID,
    syncedAt: Date.now(),
    templates: [
      {
        id: "3001",
        name: "order_update",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [
          { type: "HEADER", format: "TEXT", text: "Order update" },
          {
            type: "BODY",
            text: "Hi {{1}}, your order is ready.",
            example: { body_text: [["Pablo"]] },
          },
          { type: "FOOTER", text: "Thank you" },
          {
            type: "BUTTONS",
            buttons: [{ type: "QUICK_REPLY", text: "Thanks!" }],
          },
        ],
      },
    ],
  })
  return (await f.t.run((ctx) =>
    ctx.db
      .query("templates")
      .withIndex("by_organizationId", (q) => q.eq("organizationId", f.team))
      .first()
  ))!
}

const renderedOrder = (name: string) => ({
  header: { format: "TEXT", text: "Order update" },
  body: `Hi ${name}, your order is ready.`,
  footer: "Thank you",
  buttons: [{ type: "QUICK_REPLY", text: "Thanks!" }],
})

for (const format of ["IMAGE", "VIDEO", "DOCUMENT"] as const) {
  test(`reply sends a ${format} template header from a supplied upload, and refuses missing media`, async () => {
    const f = await setup()
    const template = await approvedTemplate(f)
    await f.t.run(async (ctx) => {
      const published = (await ctx.db
        .query("publishedTemplates")
        .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
        .unique())!
      await ctx.db.patch("publishedTemplates", published._id, {
        components: [
          {
            type: "HEADER",
            format,
            example: { header_handle: ["4::review-only-handle"] },
          },
          { type: "BODY", text: "Hi {{1}}" },
        ],
      })
    })
    await project(f, incoming())
    const id = await thread(f, "whatsapp")
    await expire(f, id)
    const expected = `This template needs a header ${format.toLowerCase()}.`
    expect(
      await f.member.client.query(api.conversations.templateInputs, {
        id,
        templateId: template._id,
      })
    ).toEqual({ variables: ["header_media", "1"], header: { format } })
    await expect(
      f.member.client.mutation(api.conversations.reply, {
        id,
        template: { id: template._id, variables: { "1": "Ada" } },
      })
    ).rejects.toMatchObject({ data: expected })
    await expect(
      f.t.run((ctx) =>
        createChannelMessage(
          ctx,
          {
            channel: "whatsapp",
            from: f.account,
            to: SENDER,
            body: { template: { id: template._id, variables: { "1": "Ada" } } },
          },
          { organizationId: f.team, source: "api" }
        )
      )
    ).rejects.toMatchObject({
      data: { statusCode: 422, message: expected },
    })
    const contentType =
      format === "IMAGE"
        ? "image/png"
        : format === "VIDEO"
          ? "video/mp4"
          : "application/pdf"
    const pending = await f.member.client.action(
      api.storage.objects.createUpload,
      {
        organizationId: f.team,
        input: {
          use: "whatsapp",
          from: f.account,
          filename: "header",
          contentType,
          size: 3,
        },
      }
    )
    const storageId = await storeUpload(
      f.t,
      new Blob(["abc"], { type: contentType })
    )
    await f.member.client.action(api.storage.objects.completeUpload, {
      organizationId: f.team,
      id: pending.id,
      storageId,
    })
    const sent = (await f.member.client.mutation(api.conversations.reply, {
      id,
      template: {
        id: template._id,
        variables: { "1": "Ada" },
        headerFileId: pending.id,
      },
    })) as Id<"channelMessages">
    const content = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", sent))
        .unique()
    )
    const media = format.toLowerCase()
    expect(JSON.parse(content!.payload).template.components[0]).toEqual({
      type: "header",
      parameters: [{ type: media, [media]: { id: pending.id } }],
    })
    const graph = fakeGraph([
      {
        method: "POST",
        path: `/${PHONE_ID}/media`,
        respond: () => ({ id: "900123" }),
      },
      {
        method: "POST",
        path: `/${PHONE_ID}/messages`,
        respond: () => ({ messages: [{ id: "wamid.header" }] }),
      },
    ])
    await f.t.action(internal.channels.deliver.deliver, {
      id: sent,
      generation: 0,
    })
    expect(graph.to(`/${PHONE_ID}/media`)).toHaveLength(1)
    expect(graph.to(`/${PHONE_ID}/messages`)[0].body).toMatchObject({
      template: {
        components: [
          {
            type: "header",
            parameters: [{ type: media, [media]: { id: "900123" } }],
          },
          { type: "body", parameters: [{ type: "text", text: "Ada" }] },
        ],
      },
    })
  })
}

test("reply falls back to a retained template sample, uploads it on the sending account, and requires media if storage disappears", async () => {
  const f = await setup()
  const template = await approvedTemplate(f)
  const sample = await f.t.run(async (ctx) => {
    const storageId = await ctx.storage.store(
      new Blob(["png"], { type: "image/png" })
    )
    const fileId = await ctx.db.insert("storedFiles", {
      organizationId: f.team,
      provider: "convex",
      feature: "template",
      state: "ready",
      storageId,
      size: 3,
      contentType: "image/png",
      filename: "sample.png",
    })
    await ctx.db.patch("templates", template._id, {
      whatsapp: { ...template.whatsapp!, sampleFileId: fileId },
    })
    const published = (await ctx.db
      .query("publishedTemplates")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .unique())!
    await ctx.db.patch("publishedTemplates", published._id, {
      components: [
        {
          type: "HEADER",
          format: "IMAGE",
          example: { header_handle: ["4::review-handle"] },
        },
        { type: "BODY", text: "An update" },
      ],
    })
    return { fileId, storageId }
  })
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  await expire(f, id)
  expect(
    await f.member.client.query(api.conversations.templateInputs, {
      id,
      templateId: template._id,
    })
  ).toMatchObject({ header: { format: "IMAGE", sampleFileId: sample.fileId } })
  const sent = (await f.member.client.mutation(api.conversations.reply, {
    id,
    template: { id: template._id, variables: {} },
  })) as Id<"channelMessages">
  const graph = fakeGraph([
    {
      method: "POST",
      path: `/${PHONE_ID}/media`,
      respond: () => ({ id: "900456" }),
    },
    {
      method: "POST",
      path: `/${PHONE_ID}/messages`,
      respond: () => ({ messages: [{ id: "wamid.sample" }] }),
    },
  ])
  await f.t.action(internal.channels.deliver.deliver, {
    id: sent,
    generation: 0,
  })
  expect(graph.to(`/${PHONE_ID}/media`)).toHaveLength(1)
  expect(graph.to(`/${PHONE_ID}/messages`)[0].body).toMatchObject({
    template: {
      components: [
        {
          type: "header",
          parameters: [{ type: "image", image: { id: "900456" } }],
        },
      ],
    },
  })
  await f.t.run((ctx) => ctx.storage.delete(sample.storageId))
  await expect(
    f.member.client.mutation(api.conversations.reply, {
      id,
      template: { id: template._id, variables: {} },
    })
  ).rejects.toMatchObject({
    data: expect.stringContaining("This template needs a header image."),
  })
})

test("an inbound WhatsApp message opens an unread thread the inbox lists, filters, searches and counts", async () => {
  const f = await setup()
  await project(f, incoming())
  const { page: rows } = await f.list()
  expect(rows).toEqual([
    expect.objectContaining({
      name: "Sheena Nelson",
      handle: `+${SENDER}`,
      conversation: expect.objectContaining({
        channel: "whatsapp",
        status: "open",
        unread: true,
        unreadCount: 1,
        lastDirection: "inbound",
        lastPreview: "Does it come in another color?",
      }),
    }),
  ])
  await receive(f)
  expect((await f.list()).page.map((row) => row.conversation.channel)).toEqual([
    "email",
    "whatsapp",
  ])
  expect((await f.list({ channel: "whatsapp" })).page).toHaveLength(1)
  expect((await f.list({ search: "sheena" })).page).toHaveLength(1)
  expect((await f.list({ search: "lovelace" })).page).toHaveLength(1)
  expect((await f.list({ search: "nobody" })).page).toHaveLength(0)
  expect((await f.list({ status: "closed" })).page).toHaveLength(0)
  expect(
    await f.member.client.query(api.conversations.count, {
      organizationId: f.team,
      unread: true,
    })
  ).toEqual({ total: 2 })
})

test("reading clears the unread count; closing hides a thread from Open until the person writes again", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  await f.member.client.mutation(api.conversations.markRead, { id })
  expect((await f.list({ unread: true })).page).toHaveLength(0)
  expect((await f.list()).page[0].conversation).toMatchObject({
    unread: false,
    unreadCount: 0,
  })
  await f.member.client.mutation(api.conversations.setStatus, {
    id,
    status: "closed",
  })
  expect((await f.list({ status: "open" })).page).toHaveLength(0)
  expect(
    await f.member.client.query(api.conversations.count, {
      organizationId: f.team,
      status: "closed",
    })
  ).toEqual({ total: 1 })
  await project(f, incoming("wamid.again"))
  expect((await f.list({ status: "open" })).page[0].conversation).toMatchObject(
    { status: "open", unread: true, unreadCount: 1 }
  )
})

test("a reply inside the window queues a dashboard message; outside it the standard 422 message comes back", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const detail = await f.member.client.query(api.conversations.get, { id })
  expect(detail).toMatchObject({
    name: "Sheena Nelson",
    account: { handle: "+15550783881", wabaId: WABA_ID },
    contact: { phone: `+${SENDER}` },
  })
  expect(detail!.conversation.windowExpiresAt).toBeGreaterThan(Date.now())
  const replyId = await f.member.client.mutation(api.conversations.reply, {
    id,
    text: "On its way!",
  })
  const message = await f.t.run((ctx) =>
    ctx.db.get("channelMessages", replyId as Id<"channelMessages">)
  )
  expect(message).toMatchObject({
    source: "dashboard",
    direction: "outbound",
    status: "queued",
    to: SENDER,
    conversationId: id,
  })
  const thread1 = await f.member.client.query(api.conversations.messages, {
    id,
    paginationOpts: page,
  })
  expect(thread1.page.map((m) => [m.direction, m.text, m.status])).toEqual([
    ["outbound", "On its way!", "queued"],
    ["inbound", "Does it come in another color?", "received"],
  ])
  expect((await f.list()).page[0].conversation).toMatchObject({
    lastDirection: "outbound",
    lastPreview: "On its way!",
  })

  await expire(f, id)
  await expect(
    f.member.client.mutation(api.conversations.reply, { id, text: "Late" })
  ).rejects.toMatchObject({ data: WINDOW_CLOSED })
})

test("an approved template is sent with its variables once the window has closed", async () => {
  const f = await setup()
  const template = await approvedTemplate(f)
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  await expire(f, id)
  expect(
    await f.member.client.query(api.conversations.templateVariables, {
      id,
      templateId: template._id,
    })
  ).toEqual(["1"])
  await expect(
    f.member.client.mutation(api.conversations.reply, {
      id,
      template: { id: template._id, variables: {} },
    })
  ).rejects.toMatchObject({ data: expect.stringContaining("1") })
  const sent = await f.member.client.mutation(api.conversations.reply, {
    id,
    template: { id: template._id, variables: { "1": "Ada" } },
  })
  const row = await f.t.run(async (ctx) => {
    const messageId = sent as Id<"channelMessages">
    return {
      message: await ctx.db.get("channelMessages", messageId),
      content: await ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
        .unique(),
    }
  })
  expect(row.message).toMatchObject({
    type: "template",
    preview: "Hi Ada, your order is ready.",
  })
  expect(JSON.parse(row.content!.payload).template).toMatchObject({
    name: "order_update",
    components: [{ type: "body", parameters: [{ type: "text", text: "Ada" }] }],
  })
  expect(row.content!.rendered).toEqual(renderedOrder("Ada"))
  expect((await f.list()).page[0].conversation.lastPreview).toBe(
    "Hi Ada, your order is ready."
  )
  // Later published edits cannot change the actual send's snapshot.
  await f.t.run(async (ctx) => {
    const published = (await ctx.db
      .query("publishedTemplates")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .unique())!
    await ctx.db.patch("publishedTemplates", published._id, {
      components: [{ type: "BODY", text: "Changed {{1}}" }],
    })
  })
  expect(
    (
      await f.member.client.query(api.conversations.messages, {
        id,
        paginationOpts: page,
      })
    ).page[0]
  ).toMatchObject({
    text: renderedOrder("Ada").body,
    rendered: renderedOrder("Ada"),
  })
  expect(
    await f.member.client.query(api.messages.get, { id: sent })
  ).toMatchObject({ rendered: renderedOrder("Ada") })
})

test("old template rows render from the published copy, including paused templates and missing parameters", async () => {
  const f = await setup()
  const template = await approvedTemplate(f)
  const sent = await f.t.run((ctx) =>
    createChannelMessage(
      ctx,
      {
        channel: "whatsapp",
        from: f.account,
        to: SENDER,
        body: { template: { id: template._id, variables: { "1": "Pablo" } } },
      },
      { organizationId: f.team, source: "api" }
    )
  )
  const message = await f.t.run(async (ctx) => {
    const content = (await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", sent))
      .unique())!
    await ctx.db.patch("channelMessageContents", content._id, {
      rendered: undefined,
    })
    await patchRow(ctx, "channelMessages", sent, {
      preview: "[template: order_update]",
    })
    await patchRow(ctx, "templates", template._id, {
      whatsapp: { ...template.whatsapp!, metaStatus: "PAUSED" },
    })
    const draft = (await ctx.db
      .query("templateDrafts")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .unique())!
    await ctx.db.patch("templateDrafts", draft._id, {
      content: [{ type: "BODY", text: "Unpublished edit" }],
    })
    return (await ctx.db.get("channelMessages", sent))!
  })
  const bubbles = await f.member.client.query(api.conversations.messages, {
    id: message.conversationId,
    paginationOpts: page,
  })
  expect(bubbles.page[0]).toMatchObject({
    text: renderedOrder("Pablo").body,
    rendered: renderedOrder("Pablo"),
  })
  expect(
    await f.member.client.query(api.messages.get, { id: sent })
  ).toMatchObject({ rendered: renderedOrder("Pablo") })
  await f.t.run(async (ctx) => {
    const content = (await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", sent))
      .unique())!
    const payload = JSON.parse(content.payload)
    payload.template.components = []
    await ctx.db.patch("channelMessageContents", content._id, {
      payload: JSON.stringify(payload),
    })
  })
  expect(
    (
      await f.member.client.query(api.conversations.messages, {
        id: message.conversationId,
        paginationOpts: page,
      })
    ).page[0]
  ).toMatchObject({ rendered: { body: "Hi {{1}}, your order is ready." } })
  // A different WABA's published copy must never supply the old row.
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { wabaId: "another-waba" })
  )
  expect(
    (
      await f.member.client.query(api.conversations.messages, {
        id: message.conversationId,
        paginationOpts: page,
      })
    ).page[0]
  ).toMatchObject({ rendered: { body: "Template: order_update", buttons: [] } })
  expect(
    await f.member.client.query(api.messages.get, { id: sent })
  ).toMatchObject({ rendered: { body: "Template: order_update", buttons: [] } })
})

for (const reference of ["name", "alias", "raw"] as const) {
  test(`a ${reference} template API send snapshots the rendered body`, async () => {
    const f = await setup()
    const template = await approvedTemplate(f)
    const ref =
      reference === "name"
        ? {
            name: template.name,
            language: "en_US",
            variables: { "1": "Pablo" },
          }
        : reference === "alias"
          ? { alias: template.alias, variables: { "1": "Pablo" } }
          : {
              name: template.name,
              language: { code: "en_US" },
              components: [
                { type: "body", parameters: [{ type: "text", text: "Pablo" }] },
              ],
            }
    const sent = await f.t.run((ctx) =>
      createChannelMessage(
        ctx,
        {
          channel: "whatsapp",
          from: f.account,
          to: SENDER,
          body: { template: ref },
        },
        { organizationId: f.team, source: "api" }
      )
    )
    expect(
      await f.member.client.query(api.messages.get, { id: sent })
    ).toMatchObject({
      rendered: renderedOrder("Pablo"),
      message: { preview: renderedOrder("Pablo").body },
    })
  })
}

test("received email becomes one thread per sender, linked to the contact, and a reply threads the answer", async () => {
  const f = await setup()
  const contact = await f.t.run((ctx) =>
    insertRow(ctx, "contacts", {
      organizationId: f.team,
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Byron",
      unsubscribed: false,
      properties: {},
      search: "ada@example.com Ada Byron",
      updatedAt: Date.now(),
    })
  )
  await receive(f)
  vi.setSystemTime(Date.now() + 1000)
  await receive(f, "ada@example.com", "Re: Order question")
  const id = await thread(f, "email")
  const detail = await f.member.client.query(api.conversations.get, { id })
  expect(detail).toMatchObject({
    name: "Ada Byron",
    handle: "ada@example.com",
    contact: { id: contact },
    account: null,
    lastEmail: { subject: "Re: Order question" },
    conversation: { unreadCount: 2, emailAddress: "ada@example.com" },
  })
  await expect(
    f.member.client.mutation(api.conversations.reply, { id, text: "Hi" })
  ).rejects.toMatchObject({ data: "Missing `from` field." })
  vi.setSystemTime(Date.now() + 1000)
  const emailId = await f.member.client.mutation(api.conversations.reply, {
    id,
    text: "It ships today.",
    from: "Support <support@mail.example.test>",
  })
  const sent = await f.t.run(async (ctx) => ({
    email: await ctx.db.get("emails", emailId as Id<"emails">),
    content: await ctx.db
      .query("emailContents")
      .withIndex("by_emailId", (q) => q.eq("emailId", emailId as Id<"emails">))
      .unique(),
  }))
  expect(sent.email).toMatchObject({
    to: ["ada@example.com"],
    subject: "Re: Order question",
    source: "dashboard",
  })
  expect(sent.content?.headers).toEqual([
    { name: "In-Reply-To", value: "<question@example.com>" },
    { name: "References", value: "<question@example.com>" },
  ])
  const messages = await f.member.client.query(api.conversations.messages, {
    id,
    paginationOpts: page,
  })
  expect(messages.page.map((m) => [m.kind, m.direction, m.text])).toEqual([
    ["email", "outbound", "It ships today."],
    ["received", "inbound", "Where is my order?"],
    ["received", "inbound", "Where is my order?"],
  ])
  expect((await f.list()).page[0].conversation).toMatchObject({
    lastDirection: "outbound",
    lastPreview: "It ships today.",
    // A send keeps the name mail gave the thread.
    search: expect.stringContaining("Ada Lovelace"),
  })
})

test("another team cannot list, read, change or reply to a thread", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const outsider = f.outsider.client
  await expect(
    outsider.query(api.conversations.list, {
      organizationId: f.team,
      paginationOpts: page,
    })
  ).rejects.toBeDefined()
  await expect(
    outsider.query(api.conversations.get, { id })
  ).rejects.toBeDefined()
  await expect(
    outsider.query(api.conversations.messages, { id, paginationOpts: page })
  ).rejects.toBeDefined()
  for (const call of [
    () => outsider.mutation(api.conversations.markRead, { id }),
    () =>
      outsider.mutation(api.conversations.setStatus, { id, status: "closed" }),
    () => outsider.mutation(api.conversations.reply, { id, text: "Hi" }),
  ])
    await expect(call()).rejects.toBeDefined()
  expect(
    (
      await outsider.query(api.conversations.list, {
        organizationId: f.outsider.team,
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(0)
  expect((await f.list()).page[0].conversation.unread).toBe(true)
})

test("Sending and Receiving merge email and WhatsApp by time, and filter by channel and status", async () => {
  const f = await setup()
  await project(f, incoming())
  vi.setSystemTime(Date.now() + 1000)
  await receive(f)
  vi.setSystemTime(Date.now() + 1000)
  const whatsapp = (await f.member.client.mutation(api.conversations.reply, {
    id: await thread(f, "whatsapp"),
    text: "On its way!",
  })) as Id<"channelMessages">
  vi.setSystemTime(Date.now() + 1000)
  const email = (await f.member.client.mutation(api.conversations.reply, {
    id: await thread(f, "email"),
    text: "Shipped.",
    from: "support@mail.example.test",
  })) as Id<"emails">
  const sending = (filters: Record<string, unknown> = {}) =>
    f.member.client.query(api.messages.sending, {
      organizationId: f.team,
      paginationOpts: page,
      ...filters,
    })
  const ids = (rows: Awaited<ReturnType<typeof sending>>) =>
    rows.page.map((row) =>
      row.kind === "email" ? row.email._id : row.message._id
    )
  expect(ids(await sending())).toEqual([email, whatsapp])
  expect(ids(await sending({ channel: "whatsapp" }))).toEqual([whatsapp])
  expect((await sending({ channel: "whatsapp" })).page[0]).toMatchObject({
    partyLabel: `+${SENDER}`,
  })
  expect(ids(await sending({ channel: "email" }))).toEqual([email])
  expect(ids(await sending({ status: "queued" }))).toEqual([email, whatsapp])
  expect(ids(await sending({ status: "opened" }))).toEqual([])
  expect(ids(await sending({ search: "on its way" }))).toEqual([whatsapp])
  // One row a page still pages through both tables in order.
  const first = await f.member.client.query(api.messages.sending, {
    organizationId: f.team,
    paginationOpts: { cursor: null, numItems: 1 },
  })
  const second = await f.member.client.query(api.messages.sending, {
    organizationId: f.team,
    paginationOpts: { cursor: first.continueCursor, numItems: 1 },
  })
  expect([...ids(first), ...ids(second)]).toEqual([email, whatsapp])
  expect(
    await f.member.client.query(api.messages.sendingCount, {
      organizationId: f.team,
    })
  ).toEqual({ total: 2 })
  expect(
    await f.member.client.query(api.messages.sendingCount, {
      organizationId: f.team,
      channel: "whatsapp",
    })
  ).toEqual({ total: 1 })

  const receiving = await f.member.client.query(api.messages.receiving, {
    organizationId: f.team,
    paginationOpts: page,
  })
  expect(receiving.page.map((row) => row.kind)).toEqual(["email", "channel"])
  expect(
    await f.member.client.query(api.messages.receivingCount, {
      organizationId: f.team,
    })
  ).toEqual({ total: 2 })
  expect(
    (
      await f.member.client.query(api.messages.receiving, {
        organizationId: f.team,
        channel: "whatsapp",
        paginationOpts: page,
      })
    ).page
  ).toHaveLength(1)

  const detail = await f.member.client.query(api.messages.get, {
    id: whatsapp,
  })
  expect(detail).toMatchObject({
    message: { _id: whatsapp, status: "queued" },
    account: { handle: "+15550783881" },
    events: [expect.objectContaining({ type: "queued" })],
  })
  expect(JSON.parse(detail!.payload)).toMatchObject({ to: SENDER })
  await expect(
    f.outsider.client.query(api.messages.get, { id: whatsapp })
  ).rejects.toBeDefined()
  await expect(
    f.outsider.client.query(api.messages.sending, {
      organizationId: f.team,
      paginationOpts: page,
    })
  ).rejects.toBeDefined()
})

for (const channel of ["messenger", "instagram"] as const) {
  test(`an inbox reply to ${channel} uses its own account, recipient, payload and window`, async () => {
    const graph = fakeGraph(pageGraphRoutes())
    const f = await pagesFixture()
    const payload = pageEnvelope(channel, {
      message: { mid: `mid.inbox.${channel}`, text: "Question" },
    })
    expect(
      (
        await f.t.fetch(
          "/meta/webhook",
          await signedWebhook(APP_SECRET, payload)
        )
      ).status
    ).toBe(200)
    const event = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").order("desc").first()
    )
    await f.t.mutation(internal.meta.projection.project, { id: event!._id })
    const threads = await f.member.client.query(api.conversations.list, {
      organizationId: f.owner.team,
      channel,
      paginationOpts: page,
    })
    const id = threads.page[0].conversation._id
    await expect(
      f.outsider.client.mutation(api.conversations.reply, {
        id,
        text: "Forbidden",
      })
    ).rejects.toBeDefined()
    const sent = (await f.member.client.mutation(api.conversations.reply, {
      id,
      text: "On its way!",
    })) as Id<"channelMessages">
    const message = await f.t.run((ctx) => ctx.db.get("channelMessages", sent))
    expect(message).toMatchObject({
      channel,
      conversationId: id,
      source: "dashboard",
      to: channel === "messenger" ? PSID : IGSID,
      status: "queued",
    })
    const log = await f.member.client.query(api.messages.sending, {
      organizationId: f.owner.team,
      channel,
      paginationOpts: page,
    })
    expect(
      log.page.map((row) => row.kind === "channel" && row.message._id)
    ).toEqual([sent])
    expect(log.page[0]).toMatchObject({ partyLabel: "Contact" })
    await f.t.run((ctx) =>
      ctx.db.patch("channelContacts", message!.channelContactId, {
        profileName: "Ada",
        ...(channel === "instagram" ? { username: "ada" } : {}),
      })
    )
    const partyLabel = channel === "instagram" ? "@ada" : "Ada"
    expect(
      (
        await f.member.client.query(api.messages.sending, {
          organizationId: f.owner.team,
          channel,
          paginationOpts: page,
        })
      ).page[0]
    ).toMatchObject({ partyLabel })
    expect(
      await f.member.client.query(api.messages.sendingCount, {
        organizationId: f.owner.team,
        channel,
      })
    ).toEqual({ total: 1 })
    expect(
      (
        await f.member.client.query(api.messages.receiving, {
          organizationId: f.owner.team,
          channel,
          paginationOpts: page,
        })
      ).page
    ).toHaveLength(1)
    expect(
      (
        await f.member.client.query(api.messages.receiving, {
          organizationId: f.owner.team,
          channel,
          paginationOpts: page,
        })
      ).page[0]
    ).toMatchObject({ partyLabel })
    const detail = await f.member.client.query(api.messages.get, {
      id: sent,
      now: Date.now(),
    })
    expect(detail!.normalized).toMatchObject({
      channel,
      type: "text",
      content: { body: "On its way!" },
    })
    const claim = await f.t.mutation(internal.channels.messages.claim, {
      id: sent,
      generation: 0,
    })
    expect(claim!.phoneNumberId).toBe(PAGE_ID)
    expect(JSON.parse(claim!.payload)).toMatchObject({
      recipient: { id: message!.to },
      message: { text: "On its way!" },
    })
    const bubbles = await f.member.client.query(api.conversations.messages, {
      id,
      paginationOpts: page,
    })
    expect(bubbles.page.map((bubble) => bubble.text)).toEqual([
      "On its way!",
      "Question",
    ])
    await f.t.run((ctx) =>
      patchRow(ctx, "conversations", id, { windowExpiresAt: Date.now() - 1 })
    )
    await expect(
      f.member.client.mutation(api.conversations.reply, { id, text: "Late" })
    ).rejects.toMatchObject({ data: expect.stringContaining("24-hour") })
    expect(graph.to(`/${PAGE_ID}/messages`)).toHaveLength(0)
  })
}

test("thread content is the shared normalized projection, including reaction targets and signed media", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const target = (
    await f.member.client.query(api.conversations.messages, {
      id,
      paginationOpts: page,
    })
  ).page[0]
  if (!("normalized" in target)) throw new Error("Channel content missing")
  expect(target.normalized).toMatchObject({
    type: "text",
    content: { body: "Does it come in another color?" },
    raw: { type: "text" },
    attachments: [],
    reactions: [],
  })
  await f.t.run(async (ctx) => {
    const original = await ctx.db.get(
      "channelMessages",
      target.id as Id<"channelMessages">
    )
    const reaction = await insertRow(
      ctx,
      "channelMessages",
      {
        ...Object.fromEntries(
          Object.entries(original!).filter(([key]) => !key.startsWith("_"))
        ),
        type: "reaction",
        externalId: "wamid.reaction",
        reactionTargetExternalId: original!.externalId,
        preview: "👍",
      } as Omit<Doc<"channelMessages">, "_id" | "_creationTime">,
      true
    )
    await ctx.db.insert("channelMessageContents", {
      messageId: reaction._id,
      payload: JSON.stringify({
        type: "reaction",
        reaction: { message_id: original!.externalId, emoji: "👍" },
      }),
    })
    const content = await ctx.db
      .query("channelMessageContents")
      .withIndex("by_messageId", (q) => q.eq("messageId", original!._id))
      .unique()
    await ctx.db.patch("channelMessageContents", content!._id, {
      media: [{ mediaId: "media-fixture", contentType: "image/png" }],
    })
  })
  const result = await f.member.client.query(api.conversations.messages, {
    id,
    paginationOpts: page,
  })
  const original = result.page.find((message) => message.id === target.id)!
  if (!("normalized" in original)) throw new Error("Channel content missing")
  expect(original.normalized.reactions).toEqual([
    expect.objectContaining({ emoji: "👍" }),
  ])
  expect(original.normalized.attachments[0].download_url).toContain(
    "/channels/media/"
  )
  await expect(
    f.outsider.client.query(api.conversations.messages, {
      id,
      paginationOpts: page,
    })
  ).rejects.toBeDefined()
})

test("advanced replies use normal validation, permissions and window enforcement", async () => {
  const f = await setup()
  await project(f, incoming())
  const id = await thread(f, "whatsapp")
  const body = {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Choose" },
      action: {
        buttons: [{ type: "reply", reply: { id: "yes", title: "Yes" } }],
      },
    },
  }
  const sent = await f.member.client.mutation(api.conversations.reply, {
    id,
    body,
  })
  expect(
    await f.t.run((ctx) =>
      ctx.db.get("channelMessages", sent as Id<"channelMessages">)
    )
  ).toMatchObject({
    type: "interactive",
    source: "dashboard",
    conversationId: id,
  })
  await expect(
    f.outsider.client.mutation(api.conversations.reply, { id, body })
  ).rejects.toBeDefined()
  await expect(
    f.member.client.mutation(api.conversations.reply, {
      id,
      body: { type: "interactive", interactive: {} },
    })
  ).rejects.toBeDefined()
  await expire(f, id)
  await expect(
    f.member.client.mutation(api.conversations.reply, { id, body })
  ).rejects.toMatchObject({ data: WINDOW_CLOSED })
})

test("starting a conversation is idempotent, team scoped, and never opens a WhatsApp window", async () => {
  const f = await setup()
  const contactId = await f.t.run(
    async (ctx) =>
      (
        await insertRow(
          ctx,
          "contacts",
          {
            organizationId: f.team,
            phone: "+14155552671",
            firstName: "Ada",
            lastName: "",
            updatedAt: Date.now(),
            search: "ada +14155552671",
            properties: {},
            unsubscribed: false,
          },
          true
        )
      )._id
  )
  const args = {
    organizationId: f.team,
    contactId,
    channel: "whatsapp" as const,
    accountId: f.account,
  }
  const id = await f.member.client.mutation(api.conversations.start, args)
  expect(await f.member.client.mutation(api.conversations.start, args)).toBe(id)
  const detail = await f.member.client.query(api.conversations.get, { id })
  expect(detail!.contact!.id).toBe(contactId)
  expect(detail!.conversation.windowExpiresAt).toBeUndefined()
  expect(detail!.conversation.unread).toBe(false)
  await expect(
    f.member.client.mutation(api.conversations.reply, {
      id,
      text: "Cannot send",
    })
  ).rejects.toMatchObject({ data: WINDOW_CLOSED })
  await expect(
    f.outsider.client.mutation(api.conversations.start, args)
  ).rejects.toBeDefined()
  await project(f, incoming())
  const old = (await f.list()).page.find(
    (row) =>
      row.conversation.channelContactId !==
      detail!.conversation.channelContactId
  )!.conversation
  const existing = await f.member.client.mutation(api.conversations.start, {
    ...args,
    contactId: old.contactId!,
  })
  expect(existing).toBe(old._id)
  expect(
    (await f.member.client.query(api.conversations.get, { id: existing }))!
      .conversation
  ).toEqual(old)
})
