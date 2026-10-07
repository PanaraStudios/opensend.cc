/// <reference types="vite/client" />
import { storeUpload } from "./testHelpers/storage.fixture"
import { upsertChannelThread } from "./channels/identity"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { patchRow } from "./counts"
import type { Id } from "./_generated/dataModel"
import {
  APP_SECRET,
  WABA_ID,
  envelope,
  fakeGraph,
  inboundFixture,
  signedWebhook,
  type GraphRoute,
} from "./testHelpers/meta.fixture"
import { resolveWhatsAppTemplate } from "./whatsapp/templates"
import { EMPTY_TEMPLATE_FORM, componentsFromForm } from "../lib/meta/templates"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.stubEnv("SSO_ENCRYPTION_KEY", "test-sso-encryption-key-".repeat(3))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const later = () => vi.setSystemTime(Date.now() + 1000)

test("a completed template file uses the shared resumable Meta sample upload", async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "template-storage-test-secret-32-bytes")
  const f = await setup()
  const pending = await f.owner.action(api.storage.objects.createUpload, {
    organizationId: f.team,
    input: {
      use: "template",
      filename: "sample.png",
      contentType: "image/png",
      size: 3,
    },
  })
  const storageId = await storeUpload(
    f.t,
    new Blob(["png"], { type: "image/png" })
  )
  await f.owner.action(api.storage.objects.completeUpload, {
    organizationId: f.team,
    id: pending.id,
    storageId,
  })
  const id = await f.create("Media sample", {
    content: componentsFromForm({
      ...EMPTY_TEMPLATE_FORM,
      headerFormat: "IMAGE",
      headerSample: `opensend-file:${pending.id}`,
      body: "Your sample",
    }),
  })
  f.graph.use(
    {
      method: "POST",
      path: "/1234567890/uploads",
      respond: () => ({ id: "upload:sample" }),
    },
    {
      method: "POST",
      path: "/upload:sample",
      respond: () => ({ h: "4::sample-handle" }),
    }
  )
  await f.owner.action(api.whatsapp.templateActions.publish, { id })
  expect(f.graph.to("/1234567890/uploads")[0].query).toMatchObject({
    file_name: "sample.png",
    file_type: "image/png",
    file_length: "3",
  })
  expect(f.graph.to("/upload:sample")[0]).toMatchObject({
    authorization: "OAuth connection-test-token",
    body: "png",
  })
  expect(
    f.graph.to(`/${WABA_ID}/message_templates`, "POST")[0].body
  ).toMatchObject({
    components: expect.arrayContaining([
      expect.objectContaining({
        example: { header_handle: ["4::sample-handle"] },
      }),
    ]),
  })
  const retained = await f.t.run(async (ctx) => ({
    template: await ctx.db.get("templates", id),
    file: await ctx.db.get("storedFiles", pending.id),
  }))
  expect(retained.template!.whatsapp!.sampleFileId).toBe(pending.id)
  expect(retained.file!.references).toBe(1)
  expect(retained.file!.expiresAt).toBeUndefined()
  later()
  await f.t.mutation(internal.whatsapp.templates.upsertSynced, {
    organizationId: f.team,
    wabaId: WABA_ID,
    syncedAt: Date.now(),
    templates: [
      {
        id: META_ID,
        name: retained.template!.name,
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        parameterFormat: "positional",
        components: [
          {
            type: "HEADER",
            format: "IMAGE",
            example: { header_handle: ["4::sample-handle"] },
          },
          { type: "BODY", text: "Your sample" },
        ],
      },
    ],
  })
  const sends = await f.t.run(async (ctx) =>
    (await resolveWhatsAppTemplate(ctx, f.team, { id })).sendComponents({})
  )
  expect(sends).toEqual([
    {
      type: "header",
      parameters: [{ type: "image", image: { id: pending.id } }],
    },
  ])
})

const META_ID = "1689556908129832"
const BODY = componentsFromForm({
  ...EMPTY_TEMPLATE_FORM,
  body: "Hi {{1}}, your order {{2}} has shipped.",
  buttons: [{ type: "QUICK_REPLY", text: "Track it" }],
  examples: { "1": "Pablo", "2": "860198" },
})

/** Meta's template edges, as the send and sync paths call them. */
const listed = (id: string, name: string) => ({
  id,
  name,
  language: "en_US",
  category: "MARKETING",
  status: "APPROVED",
  parameter_format: "POSITIONAL",
  components: [{ type: "BODY", text: `Hello from ${name}` }],
})
const ROUTES: GraphRoute[] = [
  {
    method: "POST",
    path: `/${WABA_ID}/message_templates`,
    respond: () => ({ id: META_ID, status: "PENDING", category: "UTILITY" }),
  },
  {
    method: "DELETE",
    path: `/${WABA_ID}/message_templates`,
    respond: () => ({ success: true }),
  },
  {
    method: "GET",
    path: `/${WABA_ID}/message_templates`,
    respond: (call) =>
      call.query.after === "page2"
        ? { data: [listed("2002", "spring_sale")], paging: { cursors: {} } }
        : {
            data: [listed("2001", "welcome_back")],
            paging: {
              cursors: { before: "page0", after: "page2" },
              next: "https://graph.facebook.com/next",
            },
          },
  },
  {
    method: "POST",
    path: `/${META_ID}`,
    respond: () => ({ success: true }),
  },
  {
    method: "GET",
    path: `/${META_ID}`,
    respond: () => ({ id: META_ID, status: "PENDING" }),
  },
]

async function setup() {
  const f = await inboundFixture()
  const graph = fakeGraph(ROUTES)
  const owner = f.owner.client
  const team = f.owner.team
  const create = async (name = "Order shipped", extra = {}) => {
    later()
    return owner.mutation(api.templates.create, {
      organizationId: team,
      name,
      channel: "whatsapp",
      content: BODY,
      whatsapp: { category: "UTILITY" },
      ...extra,
    })
  }
  const row = async (id: Id<"templates">) =>
    (await f.t.run((ctx) => ctx.db.get("templates", id)))!
  const webhook = async (field: string, value: Record<string, unknown>) => {
    const response = await f.t.fetch(
      "/meta/webhook",
      await signedWebhook(APP_SECRET, envelope(value, field))
    )
    expect(response.status).toBe(200)
    const event = await f.t.run((ctx) =>
      ctx.db.query("metaWebhookEvents").order("desc").first()
    )
    await f.t.mutation(internal.meta.projection.project, { id: event!._id })
  }
  const approve = () =>
    webhook("message_template_status_update", {
      event: "APPROVED",
      message_template_id: Number(META_ID),
      message_template_name: "order_shipped",
      message_template_language: "en_US",
      reason: "NONE",
    })
  return { ...f, graph, owner, team, create, row, webhook, approve }
}

describe("WhatsApp templates", () => {
  test("template submissions share a team quota across templates and count provider failures", async () => {
    const f = await setup()
    const ids = [await f.create(), await f.create(), await f.create()]
    f.graph.use({
      method: "POST",
      path: `/${WABA_ID}/message_templates`,
      respond: () =>
        Response.json(
          { error: { message: "Temporary failure", code: 2 } },
          { status: 503 }
        ),
    })
    for (const id of ids.slice(0, 2))
      await expect(
        f.owner.action(api.whatsapp.templateActions.publish, { id })
      ).rejects.toThrow(/Temporary failure/)
    await expect(
      f.owner.action(api.whatsapp.templateActions.publish, { id: ids[2] })
    ).rejects.toThrow(/Too many/)
    expect(f.graph.to(`/${WABA_ID}/message_templates`, "POST")).toHaveLength(2)
  })

  test("manual template sync limits whole paged listings per team", async () => {
    const f = await setup()
    for (let index = 0; index < 2; index++)
      await f.owner.action(api.whatsapp.templateActions.sync, {
        organizationId: f.team,
      })
    await expect(
      f.owner.action(api.whatsapp.templateActions.sync, {
        organizationId: f.team,
      })
    ).rejects.toThrow(/Too many/)
    expect(f.graph.to(`/${WABA_ID}/message_templates`, "GET")).toHaveLength(4)
  })

  test("a draft takes a Meta name and the team's WABA, then publishing submits it", async () => {
    const f = await setup()
    const id = await f.create()
    expect(await f.row(id)).toMatchObject({
      channel: "whatsapp",
      name: "order_shipped",
      status: "draft",
      variables: ["1", "2"],
      whatsapp: {
        wabaId: WABA_ID,
        language: "en_US",
        category: "UTILITY",
        parameterFormat: "positional",
      },
    })
    later()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    const [call] = f.graph.to(`/${WABA_ID}/message_templates`, "POST")
    expect(call.authorization).toBe("Bearer connection-test-token")
    expect(call.body).toEqual({
      name: "order_shipped",
      language: "en_US",
      category: "UTILITY",
      parameter_format: "positional",
      components: BODY,
    })
    expect(await f.row(id)).toMatchObject({
      status: "published",
      whatsapp: { metaTemplateId: META_ID, metaStatus: "PENDING" },
    })
    const live = await f.t.run((ctx) =>
      ctx.db
        .query("publishedTemplates")
        .withIndex("by_templateId", (q) => q.eq("templateId", id))
        .unique()
    )
    expect(live?.components).toEqual(BODY)
    // Email publishing refuses it: it lives at Meta, not rendered here.
    await expect(
      f.owner.mutation(api.templates.publish, { id })
    ).rejects.toThrow("submitting them to Meta")
    await expect(
      f.owner.mutation(api.templates.remove, { id })
    ).rejects.toThrow("delete it there")
  })

  test("a draft Meta would refuse is caught before any Graph call", async () => {
    const f = await setup()
    const id = await f.create("Missing example", {
      content: componentsFromForm({
        ...EMPTY_TEMPLATE_FORM,
        body: "Hi {{1}} there",
      }),
    })
    await expect(
      f.owner.action(api.whatsapp.templateActions.publish, { id })
    ).rejects.toThrow("Add an example for {{1}} in the body")
    expect(f.graph.calls).toHaveLength(0)
    await expect(
      f.outsider.client.action(api.whatsapp.templateActions.publish, { id })
    ).rejects.toThrow()
  })

  test("status webhooks approve, reject with Meta's reason, recategorize and rate", async () => {
    const f = await setup()
    const id = await f.create()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    await f.approve()
    expect((await f.row(id)).whatsapp?.metaStatus).toBe("APPROVED")
    const events = (
      await f.t.run((ctx) => ctx.db.query("events").collect())
    ).filter((event) => event.type === "whatsapp.template.status_updated")
    expect(events.at(-1)?.data).toMatchObject({
      template_id: id,
      waba_id: WABA_ID,
      event: "APPROVED",
    })
    await f.webhook("message_template_status_update", {
      event: "REJECTED",
      message_template_id: Number(META_ID),
      reason: "INVALID_FORMAT",
      rejection_info: {
        reason: "Your template has parameters placed next to each other.",
      },
    })
    expect((await f.row(id)).whatsapp).toMatchObject({
      metaStatus: "REJECTED",
      rejectedReason: "Your template has parameters placed next to each other.",
    })
    await f.webhook("template_category_update", {
      message_template_id: Number(META_ID),
      previous_category: "UTILITY",
      new_category: "MARKETING",
    })
    await f.webhook("message_template_quality_update", {
      message_template_id: Number(META_ID),
      previous_quality_score: "GREEN",
      new_quality_score: "YELLOW",
    })
    expect((await f.row(id)).whatsapp).toMatchObject({
      category: "MARKETING",
      quality: "YELLOW",
    })
    // An update for a template the team does not have touches nothing.
    await f.webhook("message_template_status_update", {
      event: "DISABLED",
      message_template_id: 555,
    })
    expect((await f.row(id)).whatsapp?.metaStatus).toBe("REJECTED")
  })

  test("an approved template is edited in place at Meta, keeping its category", async () => {
    const f = await setup()
    const id = await f.create()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    await f.approve()
    later()
    await f.owner.mutation(api.templates.update, {
      id,
      content: componentsFromForm({
        ...EMPTY_TEMPLATE_FORM,
        body: "Hi {{1}}, order {{2}} is on its way.",
        examples: { "1": "Pablo", "2": "860198" },
      }),
    })
    await expect(
      f.owner.mutation(api.templates.update, { id, name: "renamed" })
    ).rejects.toThrow("Meta does not allow")
    await expect(
      f.owner.mutation(api.templates.update, {
        id,
        whatsapp: { category: "MARKETING" },
      })
    ).rejects.toThrow("approved template")
    later()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    const [edit] = f.graph.to(`/${META_ID}`, "POST")
    expect(edit.body).toMatchObject({ parameter_format: "positional" })
    expect(edit.body).not.toHaveProperty("category")
    expect((await f.row(id)).whatsapp?.metaStatus).toBe("PENDING")
    // Meta is reviewing it again: another edit waits.
    await expect(
      f.owner.action(api.whatsapp.templateActions.publish, { id })
    ).rejects.toThrow("Meta is reviewing")
  })

  test("sync imports every page, adopts known templates and marks dropped ones deleted", async () => {
    const f = await setup()
    const id = await f.create()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    later()
    // welcome_back arrives on page one, spring_sale on page two.
    const result = await f.owner.action(api.whatsapp.templateActions.sync, {
      organizationId: f.team,
    })
    expect(result).toEqual({ synced: 2 })
    const lists = f.graph.to(`/${WABA_ID}/message_templates`, "GET")
    expect(lists.map((call) => call.query.after)).toEqual([undefined, "page2"])
    expect(lists[0].query.fields).toContain("quality_score")
    const rows = await f.t.run((ctx) => ctx.db.query("templates").collect())
    const imported = rows.find((row) => row.name === "spring_sale")!
    expect(imported).toMatchObject({
      channel: "whatsapp",
      status: "published",
      whatsapp: {
        wabaId: WABA_ID,
        metaTemplateId: "2002",
        metaStatus: "APPROVED",
        category: "MARKETING",
      },
    })
    const draft = await f.t.run((ctx) =>
      ctx.db
        .query("templateDrafts")
        .withIndex("by_templateId", (q) => q.eq("templateId", imported._id))
        .unique()
    )
    expect(draft?.content).toEqual([
      { type: "BODY", text: "Hello from spring_sale" },
    ])
    // Our submitted template was not listed: Meta no longer has it.
    expect((await f.row(id)).whatsapp?.metaStatus).toBe("DELETED")
    const waba = await f.t.run((ctx) =>
      ctx.db.query("whatsappBusinessAccounts").first()
    )
    expect(waba?.templatesSyncedAt).toEqual(expect.any(Number))
    // A repeated listing advances the WABA clock without writing templates.
    const beforeRepeat = await f.t.run((ctx) =>
      ctx.db.query("templates").collect()
    )
    later()
    await f.owner.action(api.whatsapp.templateActions.sync, {
      organizationId: f.team,
    })
    expect(
      await f.t.run((ctx) => ctx.db.query("templates").collect())
    ).toHaveLength(3)
    expect(await f.t.run((ctx) => ctx.db.query("templates").collect())).toEqual(
      beforeRepeat
    )
  })

  test("an empty listing records the sync start and marks dropped templates deleted", async () => {
    const f = await setup()
    await f.owner.action(api.whatsapp.templateActions.sync, {
      organizationId: f.team,
    })
    f.graph.use({
      method: "GET",
      path: `/${WABA_ID}/message_templates`,
      respond: () => ({ data: [] }),
    })
    later()
    const syncedAt = Date.now()
    expect(
      await f.owner.action(api.whatsapp.templateActions.sync, {
        organizationId: f.team,
      })
    ).toEqual({ synced: 0 })
    expect(
      await f.t.run((ctx) => ctx.db.query("whatsappBusinessAccounts").first())
    ).toMatchObject({
      templatesSyncStartedAt: syncedAt,
      templatesSyncedAt: syncedAt,
    })
    const rows = await f.t.run((ctx) => ctx.db.query("templates").collect())
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.whatsapp?.metaStatus === "DELETED")).toBe(
      true
    )
  })

  test("the hourly cron fans out one sync per WABA", async () => {
    const f = await setup()
    await f.t.mutation(internal.whatsapp.templates.dispatchSync, {})
    const scheduled = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect()
    )
    expect(
      scheduled.filter((job) => job.name.includes("syncAccount"))
    ).toHaveLength(1)
  })

  test("deleting removes the template at Meta by name and id, then here", async () => {
    const f = await setup()
    const id = await f.create()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    await f.owner.action(api.whatsapp.templateActions.remove, { id })
    const [call] = f.graph.to(`/${WABA_ID}/message_templates`, "DELETE")
    expect(call.query).toEqual({ name: "order_shipped", hsm_id: META_ID })
    expect(await f.t.run((ctx) => ctx.db.get("templates", id))).toBeNull()
    // A draft never submitted goes without a Graph call.
    const draft = await f.create("Just a draft")
    await f.owner.action(api.whatsapp.templateActions.remove, { id: draft })
    expect(f.graph.to(`/${WABA_ID}/message_templates`, "DELETE")).toHaveLength(
      1
    )
  })

  test("names are unique per WABA and language, as Meta requires", async () => {
    const f = await setup()
    const first = await f.create()
    const second = await f.create()
    expect((await f.row(second)).name).toBe("order_shipped_2")
    await expect(
      f.owner.mutation(api.templates.update, {
        id: second,
        name: "order_shipped",
      })
    ).rejects.toThrow("already exists")
    // Another language may share the name.
    later()
    await f.owner.mutation(api.templates.update, {
      id: second,
      whatsapp: { language: "es" },
    })
    later()
    await f.owner.mutation(api.templates.update, {
      id: second,
      name: "order_shipped",
    })
    expect((await f.row(second)).name).toBe("order_shipped")
    expect((await f.row(first)).name).toBe("order_shipped")
    const copy = await f.owner.mutation(api.templates.duplicate, { id: first })
    expect(await f.row(copy)).toMatchObject({
      name: "order_shipped_copy",
      channel: "whatsapp",
      status: "draft",
    })
  })

  test("email lists, pickers and sends keep to email templates", async () => {
    const f = await setup()
    const whatsapp = await f.create()
    later()
    const email = await f.owner.mutation(api.templates.create, {
      organizationId: f.team,
      name: "Welcome",
      subject: "Hi",
      html: "<p>Hi</p>",
    })
    expect((await f.row(email)).channel).toBeUndefined()
    const page = (channel?: "email" | "whatsapp") =>
      f.owner.query(api.templates.list, {
        organizationId: f.team,
        ...(channel ? { channel } : {}),
        paginationOpts: { numItems: 10, cursor: null },
      })
    expect((await page()).page).toHaveLength(2)
    expect((await page("email")).page.map((row) => row._id)).toEqual([email])
    expect((await page("whatsapp")).page.map((row) => row._id)).toEqual([
      whatsapp,
    ])
    expect(
      await f.owner.query(api.templates.count, {
        organizationId: f.team,
        channel: "whatsapp",
      })
    ).toEqual({ total: null })
    const options = await f.owner.query(api.templates.options, {
      organizationId: f.team,
    })
    expect(options.map((row) => row._id)).toEqual([email])
    const whatsappOptions = await f.owner.query(api.templates.options, {
      organizationId: f.team,
      channel: "whatsapp",
    })
    expect(whatsappOptions.map((row) => row._id)).toEqual([whatsapp])
    expect(
      await f.t.query(internal.templates.published, {
        organizationId: f.team,
        idOrAlias: whatsapp,
      })
    ).toBeNull()
  })

  test("resolveWhatsAppTemplate finds an approved template and maps variables", async () => {
    const f = await setup()
    const id = await f.create()
    const resolve = (ref: Parameters<typeof resolveWhatsAppTemplate>[2]) =>
      f.t.run((ctx) => resolveWhatsAppTemplate(ctx, f.team, ref))
    await expect(resolve({ id })).rejects.toThrow("not approved")
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    await f.approve()
    const alias = (await f.row(id)).alias
    for (const ref of [
      { id },
      { alias },
      { name: "order_shipped", language: "en_US" },
      { name: "order_shipped", language: "en_US", wabaId: WABA_ID },
    ])
      expect(
        await f.t.query(internal.whatsapp.templates.resolve, {
          organizationId: f.team,
          ...ref,
        })
      ).toMatchObject({
        templateId: id,
        name: "order_shipped",
        language: "en_US",
        parameterFormat: "positional",
        variables: ["1", "2"],
      })
    const send = (variables: Record<string, string>) =>
      f.t.run(async (ctx) =>
        (await resolveWhatsAppTemplate(ctx, f.team, { id })).sendComponents(
          variables
        )
      )
    expect(await send({ "1": "Jessica", "2": "SKBUP2" })).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Jessica" },
          { type: "text", text: "SKBUP2" },
        ],
      },
    ])
    await expect(send({ "1": "Jessica" })).rejects.toThrow(
      "Missing template variables: 2"
    )
    await expect(resolve({ name: "order_shipped" })).rejects.toThrow("language")
    await expect(resolve({ id, language: "es" })).rejects.toThrow("not es")
    await expect(resolve({ id, wabaId: "999" })).rejects.toThrow(
      "another WhatsApp Business Account"
    )
  })
})

describe("the /templates REST API with channels", () => {
  async function rest() {
    const f = await setup()
    const { token } = await f.owner.action(api.apiKeys.create, {
      organizationId: f.team,
      input: { name: "CRM", permission: "full_access", domainId: null },
    })
    const call = async (path: string, method = "GET", body?: unknown) => {
      const response = await f.t.fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      return { status: response.status, body: await response.json() }
    }
    return { ...f, call }
  }

  test("email templates keep Resend's shape: no channel in or out", async () => {
    const f = await rest()
    const created = await f.call("/templates", "POST", {
      name: "Welcome",
      html: "<p>Hi</p>",
    })
    expect(created.status).toBe(201)
    const got = await f.call(`/templates/${created.body.id}`)
    expect(got.body).not.toHaveProperty("channel")
    expect(got.body).not.toHaveProperty("whatsapp")
    const list = await f.call("/templates")
    expect(list.body.data[0]).not.toHaveProperty("channel")
    const refused = await f.call("/templates", "POST", {
      name: "Welcome",
      html: "<p>Hi</p>",
      whatsapp: { language: "en_US" },
    })
    expect(refused.status).toBe(422)
  })

  test("a CRM creates, lists, publishes and deletes a WhatsApp template", async () => {
    const f = await rest()
    const created = await f.call("/templates", "POST", {
      name: "order_shipped",
      channel: "whatsapp",
      whatsapp: { category: "utility", components: BODY },
    })
    expect(created.status).toBe(201)
    const id = created.body.id
    const invalid = await f.call("/templates", "POST", {
      name: "Order Shipped",
      channel: "whatsapp",
    })
    expect(invalid.status).toBe(422)
    const taken = await f.call("/templates", "POST", {
      name: "order_shipped",
      channel: "whatsapp",
    })
    expect(taken.body.message).toContain("already exists")
    const got = await f.call(`/templates/${id}`)
    expect(got.body).toMatchObject({
      channel: "whatsapp",
      name: "order_shipped",
      status: "draft",
      html: "",
      whatsapp: {
        waba_id: WABA_ID,
        language: "en_US",
        category: "UTILITY",
        parameter_format: "positional",
        status: null,
        meta_template_id: null,
        components: BODY,
      },
    })
    expect(got.body.variables.map((item: { key: string }) => item.key)).toEqual(
      ["1", "2"]
    )
    const onlyWhatsApp = await f.call("/templates?channel=whatsapp")
    expect(onlyWhatsApp.body.data.map((row: { id: string }) => row.id)).toEqual(
      [id]
    )
    expect((await f.call("/templates?channel=sms")).status).toBe(422)
    const changed = await f.call(`/templates/${id}`, "PATCH", {
      channel: "email",
    })
    expect(changed.status).toBe(422)
    const published = await f.call(`/templates/${id}/publish`, "POST")
    expect(published.status).toBe(200)
    expect(f.graph.to(`/${WABA_ID}/message_templates`, "POST")).toHaveLength(1)
    const after = await f.call(`/templates/${id}`)
    expect(after.body.whatsapp).toMatchObject({
      status: "PENDING",
      meta_template_id: META_ID,
    })
    const removed = await f.call(`/templates/${id}`, "DELETE")
    expect(removed.body).toEqual({ object: "template", id, deleted: true })
    expect(f.graph.to(`/${WABA_ID}/message_templates`, "DELETE")).toHaveLength(
      1
    )
  })
  test("a send by stored template id fills that approved template's variables", async () => {
    const f = await setup()
    await f.t.run((ctx) =>
      patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
    )
    const id = await f.create()
    await f.owner.action(api.whatsapp.templateActions.publish, { id })
    await f.approve()
    const conversationId = await f.t.run(async (ctx) => {
      const account = (await ctx.db.get("channelAccounts", f.account))!
      return (
        await upsertChannelThread(ctx, account, {
          externalId: "16505559999",
          phone: "+16505559999",
          at: Date.now(),
          preview: "",
          direction: "outbound",
        })
      ).conversationId
    })
    const send = (variables: Record<string, string>) =>
      f.owner.mutation(api.conversations.reply, {
        id: conversationId,
        template: { id, variables },
      })
    const messageId = await send({ "1": "Jessica", "2": "SKBUP2" })
    const content = await f.t.run((ctx) =>
      ctx.db
        .query("channelMessageContents")
        .withIndex("by_messageId", (q) =>
          q.eq("messageId", messageId as Id<"channelMessages">)
        )
        .unique()
    )
    expect(JSON.parse(content!.payload).template).toEqual({
      name: "order_shipped",
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Jessica" },
            { type: "text", text: "SKBUP2" },
          ],
        },
      ],
    })
    await expect(send({ "1": "Jessica" })).rejects.toMatchObject({
      data: expect.stringContaining("Missing template variables: 2"),
    })
  })
})

test("dashboard template tests require approval and enqueue a rendered WhatsApp message to a chosen number", async () => {
  const f = await setup()
  const id = await f.create()
  const args = {
    organizationId: f.team,
    templateId: id,
    from: f.account,
    to: "+1 (555) 123-4567",
    variables: { "1": "Ada", "2": "42" },
  }
  await expect(f.owner.mutation(api.messages.sendTest, args)).rejects.toThrow(
    "approved"
  )
  await f.owner.action(api.whatsapp.templateActions.publish, { id })
  await expect(f.owner.mutation(api.messages.sendTest, args)).rejects.toThrow(
    "approved"
  )
  await f.approve()
  await f.t.run((ctx) =>
    patchRow(ctx, "channelAccounts", f.account, { registeredAt: Date.now() })
  )
  await expect(
    f.outsider.client.mutation(api.messages.sendTest, args)
  ).rejects.toBeDefined()
  await expect(
    f.owner.mutation(api.messages.sendTest, { ...args, to: "5551234567" })
  ).rejects.toThrow("country code")
  await expect(
    f.owner.mutation(api.messages.sendTest, { ...args, variables: {} })
  ).rejects.toThrow("variable")
  expect(
    await f.owner.query(api.messages.testDefinition, {
      organizationId: f.team,
      templateId: id,
    })
  ).toMatchObject({ variables: [{ key: "1" }, { key: "2" }] })
  expect(
    await f.outsider.client.query(api.messages.testDefinition, {
      organizationId: f.outsider.team,
      templateId: id,
    })
  ).toBeNull()
  const sent = await f.owner.mutation(api.messages.sendTest, args)
  const detail = await f.owner.query(api.messages.get, {
    id: sent,
    now: Date.now(),
  })
  expect(detail).toMatchObject({
    message: {
      channel: "whatsapp",
      to: "15551234567",
      source: "dashboard",
      status: "queued",
    },
    rendered: { body: "Hi Ada, your order 42 has shipped." },
    events: [expect.objectContaining({ type: "queued" })],
  })
  expect(JSON.parse(detail!.payload)).toMatchObject({
    template: {
      name: "order_shipped",
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Ada" },
            { type: "text", text: "42" },
          ],
        },
      ],
    },
  })
})
