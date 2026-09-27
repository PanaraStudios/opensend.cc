import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { FunctionArgs } from "convex/server"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { renderTemplate, TEMPLATE_BODY_LIMIT } from "./templates"
import { fixture } from "./testHelpers/ses.fixture"
import { templatePublishLabel } from "../lib/dashboard/template"

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }))
afterEach(() => vi.useRealTimers())
/* Each write happens a second after the one before, so "edited since it was
   published" is a matter of order, as it is for people. */
const later = () => vi.setSystemTime(Date.now() + 1000)

async function templates() {
  const f = await fixture()
  const owner = f.owner.client
  const team = f.owner.team
  const create = async (name: string, extra: { html?: string } = {}) => {
    later()
    return owner.mutation(api.templates.create, {
      organizationId: team,
      name,
      subject: "Hi {{{FIRST_NAME|there}}}",
      html: "<p>Welcome, {{{FIRST_NAME}}}</p>",
      ...extra,
    })
  }
  const update = (
    id: Id<"templates">,
    patch: Omit<FunctionArgs<typeof api.templates.update>, "id">
  ) => {
    later()
    return owner.mutation(api.templates.update, { id, ...patch })
  }
  const act = (
    name: "publish" | "unpublish" | "remove" | "duplicate",
    id: Id<"templates">
  ) => {
    later()
    return owner.mutation(api.templates[name], { id })
  }
  const get = async (id: Id<"templates">) =>
    (await owner.query(api.templates.get, { organizationId: team, id }))!
  const label = async (id: Id<"templates">) => {
    const { template } = await get(id)
    return templatePublishLabel({
      ...template,
      publishedAt: template.publishedAt ?? null,
    })
  }
  const live = (idOrAlias: string) =>
    f.t.query(internal.templates.published, {
      organizationId: team,
      idOrAlias,
    })
  return { ...f, team, create, update, act, get, label, live }
}

async function joinOwnerTeam(f: Awaited<ReturnType<typeof templates>>) {
  await f.owner.client.mutation(api.teams.invite, {
    organizationId: f.team,
    email: f.outsider.user.email,
    role: "member",
  })
  const snapshot = await f.outsider.client.query(api.teams.snapshot)
  await f.outsider.client.mutation(api.teams.respond, {
    invitationId: snapshot!.receivedInvitations[0].id,
    accept: true,
  })
}

describe("templates", () => {
  test("another team's member is refused, and a plain member can write", async () => {
    const f = await templates()
    const id = await f.create("Welcome")
    const outsider = f.outsider.client
    await expect(
      outsider.query(api.templates.list, {
        organizationId: f.team,
        paginationOpts: { cursor: null, numItems: 10 },
      })
    ).rejects.toThrow("permission")
    await expect(
      outsider.query(api.templates.get, { organizationId: f.team, id })
    ).rejects.toThrow("permission")
    // Asking through their own team does not reach it either.
    expect(
      await outsider.query(api.templates.get, {
        organizationId: f.outsider.team,
        id,
      })
    ).toBeNull()
    for (const name of ["publish", "unpublish", "duplicate", "remove"] as const)
      await expect(
        outsider.mutation(api.templates[name], { id })
      ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.templates.update, { id, name: "Mine" })
    ).rejects.toThrow("permission")
    await expect(
      outsider.mutation(api.templates.create, {
        organizationId: f.team,
        name: "Mine",
      })
    ).rejects.toThrow("permission")
    expect(
      await f.t.query(internal.templates.published, {
        organizationId: f.outsider.team,
        idOrAlias: id,
      })
    ).toBeNull()

    await joinOwnerTeam(f)
    await outsider.mutation(api.templates.update, { id, subject: "Hello" })
    await outsider.mutation(api.templates.publish, { id })
    const made = await outsider.mutation(api.templates.create, {
      organizationId: f.team,
      name: "From a member",
    })
    expect((await f.get(made)).template.alias).toBe("from-a-member")
    expect((await f.live("welcome"))?.subject).toBe("Hello")
  })

  test("the alias follows the name until the first publish, and stays unique", async () => {
    const f = await templates()
    const first = await f.create("Welcome")
    const second = await f.create("Welcome")
    const blank = await f.create("  ")
    expect((await f.get(first)).template.alias).toBe("welcome")
    expect((await f.get(second)).template.alias).toBe("welcome-2")
    expect((await f.get(blank)).template).toMatchObject({
      name: "Untitled Template",
      alias: "untitled-template",
    })

    await f.update(second, { name: "Order shipped" })
    expect((await f.get(second)).template.alias).toBe("order-shipped")
    // A rename onto a taken slug is numbered past it.
    await f.update(blank, { name: "Welcome" })
    expect((await f.get(blank)).template.alias).toBe("welcome-2")

    await f.act("publish", first)
    await f.update(first, { name: "Welcome aboard" })
    expect((await f.get(first)).template).toMatchObject({
      name: "Welcome aboard",
      alias: "welcome",
    })
    // Unpublishing does not free it to move again: callers may still use it.
    await f.act("unpublish", first)
    await f.update(first, { name: "Hello" })
    expect((await f.get(first)).template.alias).toBe("welcome")

    // An alias chosen by hand stays put through a rename.
    await f.update(second, { alias: "shipping_v2" })
    await f.update(second, { name: "Shipped" })
    expect((await f.get(second)).template.alias).toBe("shipping_v2")

    await expect(f.update(second, { alias: "welcome" })).rejects.toThrow(
      "Another template already uses this alias"
    )
    await expect(f.update(second, { alias: "Not OK" })).rejects.toThrow(
      "Use lowercase letters, numbers, dashes and underscores"
    )
    await expect(f.update(second, { alias: "" })).rejects.toThrow(
      "Enter an alias"
    )
    // Search finds a template by a word of its name or of its alias.
    const search = async (text: string) =>
      (
        await f.owner.client.query(api.templates.list, {
          organizationId: f.team,
          paginationOpts: { cursor: null, numItems: 10 },
          search: text,
        })
      ).page.map((row) => row._id)
    expect(await search("shipping")).toEqual([second])
    expect(await search("aboard")).toEqual([])
    expect(await search("hello")).toEqual([first])
  })

  test("publishing copies the draft; later edits wait for Publish changes", async () => {
    const f = await templates()
    const id = await f.create("Welcome")
    expect(await f.label(id)).toBe("Publish")
    expect(await f.live(id)).toBeNull()

    await f.act("publish", id)
    expect(await f.label(id)).toBeNull()
    const first = await f.live("welcome")
    expect(first).toMatchObject({
      id,
      alias: "welcome",
      subject: "Hi {{{FIRST_NAME|there}}}",
      html: "<p>Welcome, {{{FIRST_NAME}}}</p>",
      variables: [{ key: "FIRST_NAME", fallback: "there" }],
    })
    expect(await f.live(id)).toEqual(first)

    // A rename changes nothing sent, so the template stays live.
    await f.update(id, { name: "Welcome aboard" })
    expect(await f.label(id)).toBeNull()

    // Editing the draft does not touch what is sent.
    await f.update(id, {
      html: "<p>Changed</p>",
      content: { type: "doc", content: [] },
      from: "Acme <hi@acme.test>",
    })
    expect(await f.label(id)).toBe("Publish changes")
    expect(await f.live(id)).toEqual({ ...first, name: "Welcome aboard" })
    expect((await f.get(id)).html).toBe("<p>Changed</p>")

    await f.act("publish", id)
    expect(await f.label(id)).toBeNull()
    expect(await f.live(id)).toMatchObject({
      html: "<p>Changed</p>",
      from: "Acme <hi@acme.test>",
    })

    await f.act("unpublish", id)
    expect((await f.get(id)).template.status).toBe("draft")
    expect(await f.label(id)).toBe("Publish")
    expect(await f.live(id)).toBeNull()
    expect(await f.live("welcome")).toBeNull()

    const empty = await f.create("Empty", { html: " " })
    await expect(f.act("publish", empty)).rejects.toThrow(
      "Add content to this template before publishing"
    )
  })

  test("a save that changes nothing writes nothing, and cleared fields go", async () => {
    const f = await templates()
    const id = await f.create("Welcome")
    await f.update(id, {
      content: { type: "doc" },
      replyTo: "help@acme.test",
    })
    const before = await f.get(id)
    await f.update(id, {
      name: "Welcome",
      html: before.html,
      content: { type: "doc" },
    })
    expect((await f.get(id)).template.updatedAt).toBe(before.template.updatedAt)
    // Hand-written HTML drops the document; empty text drops a reply-to.
    await f.update(id, { content: null, replyTo: "" })
    const after = await f.get(id)
    expect(after.content).toBeUndefined()
    expect(after.template.replyTo).toBeUndefined()
  })

  test("duplicate makes a draft copy; delete removes every part", async () => {
    const f = await templates()
    const id = await f.create("Welcome")
    await f.update(id, { content: { type: "doc", content: [] } })
    await f.act("publish", id)
    const copy = (await f.act("duplicate", id)) as Id<"templates">
    const duplicated = await f.get(copy)
    expect(duplicated.template).toMatchObject({
      name: "Welcome copy",
      alias: "welcome-copy",
      status: "draft",
      subject: "Hi {{{FIRST_NAME|there}}}",
    })
    expect(duplicated.template.publishedAt).toBeUndefined()
    expect(duplicated.html).toBe("<p>Welcome, {{{FIRST_NAME}}}</p>")
    expect(duplicated.content).toEqual({ type: "doc", content: [] })
    expect(await f.live(copy)).toBeNull()

    await f.act("remove", id)
    expect(
      await f.owner.client.query(api.templates.get, {
        organizationId: f.team,
        id,
      })
    ).toBeNull()
    expect(await f.live("welcome")).toBeNull()
    const leftovers = await f.t.run(async (ctx) => [
      ...(await ctx.db.query("templateDrafts").take(10)),
      ...(await ctx.db.query("publishedTemplates").take(10)),
    ])
    expect(leftovers.map((row) => row.templateId)).toEqual([copy])
    // Its alias is free again.
    expect((await f.get(await f.create("Welcome"))).template.alias).toBe(
      "welcome"
    )
  })

  test("the list filters by status and pages newest first", async () => {
    const f = await templates()
    const a = await f.create("A")
    const b = await f.create("B")
    await f.act("publish", a)
    const list = async (status?: "draft" | "published") =>
      (
        await f.owner.client.query(api.templates.list, {
          organizationId: f.team,
          paginationOpts: { cursor: null, numItems: 10 },
          ...(status ? { status } : {}),
        })
      ).page
    expect((await list()).map((row) => row._id)).toEqual([b, a])
    expect((await list("published")).map((row) => row._id)).toEqual([a])
    expect((await list("draft"))[0]).toMatchObject({
      _id: b,
      html: "<p>Welcome, {{{FIRST_NAME}}}</p>",
    })
    expect(
      (
        await f.owner.client.query(api.templates.options, {
          organizationId: f.team,
        })
      ).map((row) => row._id)
    ).toEqual([b, a])
  })

  test("sizes and variables are capped", async () => {
    const f = await templates()
    const id = await f.create("Welcome")
    await expect(
      f.update(id, { html: "x".repeat(TEMPLATE_BODY_LIMIT + 1) })
    ).rejects.toThrow("The template HTML is larger than 256 KB")
    await expect(
      f.update(id, {
        content: { type: "doc", text: "x".repeat(TEMPLATE_BODY_LIMIT) },
      })
    ).rejects.toThrow("The template design is larger than 256 KB")
    await expect(
      f.create("Big", { html: "é".repeat(TEMPLATE_BODY_LIMIT / 2 + 1) })
    ).rejects.toThrow("larger than 256 KB")
    await expect(f.update(id, { name: "n".repeat(257) })).rejects.toThrow(
      "Name is too long"
    )
    const tags = (count: number) =>
      Array.from({ length: count }, (_, i) => `{{{V${i}}}}`).join("")
    // The subject's FIRST_NAME makes fifty.
    await f.update(id, { html: tags(49) })
    await expect(f.update(id, { html: tags(50) })).rejects.toThrow(
      "A template can use at most 50 variables"
    )
    // The draft is still the last one that fit.
    expect((await f.get(id)).template.variables).toHaveLength(50)
    // A copy of a name at the limit is cut to fit.
    await f.update(id, { name: "n".repeat(256) })
    const copy = (await f.act("duplicate", id)) as Id<"templates">
    expect((await f.get(copy)).template.name).toHaveLength(256)
  })
})

describe("renderTemplate", () => {
  const template = {
    subject: "Hi {{{FIRST_NAME|there}}}",
    html: "<p>{{{FIRST_NAME}}} owes {{{AMOUNT}}}. {{{contact.email}}}</p>",
    variables: [
      { key: "FIRST_NAME", fallback: "there" },
      { key: "AMOUNT" },
      { key: "contact.email" },
    ],
  }
  test("fills values, escapes them in HTML, and takes each variable's default", () => {
    expect(
      renderTemplate(template, { FIRST_NAME: "<Ada>", AMOUNT: 12 })
    ).toMatchObject({
      subject: "Hi <Ada>",
      html: "<p>&lt;Ada&gt; owes 12. </p>",
      text: "<Ada> owes 12.",
    })
    // The body's tag has no fallback of its own; the variable's default fills it.
    expect(renderTemplate(template, { AMOUNT: "5", FIRST_NAME: "" }).html).toBe(
      "<p>there owes 5. </p>"
    )
  })
  test("a variable with no value and no default fails the send", () => {
    expect(() => renderTemplate(template, { FIRST_NAME: "Ada" })).toThrow(
      "Missing template variables: AMOUNT"
    )
  })
})
