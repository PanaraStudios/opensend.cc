/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { unsubscribeLinks } from "./unsubscribe"
import {
  readUnsubscribeToken,
  signUnsubscribeToken,
} from "../lib/unsubscribe/token"
import type { Id } from "./_generated/dataModel"

const SECRET = "test-server-secret-".repeat(4)

beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET)
  vi.stubEnv("SITE_URL", "https://opensend.test")
})
afterEach(() => {
  vi.unstubAllEnvs()
})

type Fixture = Awaited<ReturnType<typeof fixture>>

async function setup() {
  const f = await fixture()
  const org = f.owner.team
  const owner = f.owner.client
  const {
    createdIds: [contactId],
  } = await owner.mutation(api.contacts.upsert, {
    organizationId: org,
    contacts: [{ email: "ada@example.com" }],
    segmentIds: [],
  })
  const topic = (
    name: string,
    visibility: "public" | "private" = "public",
    defaultSubscription: "opt_in" | "opt_out" = "opt_out"
  ) =>
    owner.mutation(api.topics.create, {
      organizationId: org,
      name,
      description: "",
      defaultSubscription,
      visibility,
    })
  const links = (topicId?: Id<"topics">) =>
    f.t.query(internal.unsubscribe.links, {
      organizationId: org,
      contactId,
      topicId,
    })
  const tokenOf = (url: string) => url.split("/unsubscribe/")[1]!
  const contact = () => f.t.run((ctx) => ctx.db.get("contacts", contactId))
  const choice = (topicId: Id<"topics">) =>
    f.t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("topicSubscriptions")
            .withIndex("by_contactId_and_topicId", (q) =>
              q.eq("contactId", contactId).eq("topicId", topicId)
            )
            .unique()
        )?.subscription ?? null
    )
  const updates = async () =>
    (
      await f.t.run((ctx) =>
        ctx.db
          .query("events")
          .withIndex("by_organizationId_and_type", (q) =>
            q.eq("organizationId", org).eq("type", "contact.updated")
          )
          .collect()
      )
    ).length
  const post = (
    token: string,
    body: BodyInit | null = "List-Unsubscribe=One-Click",
    contentType = "application/x-www-form-urlencoded"
  ) =>
    f.t.fetch(`/unsubscribe/${token}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    })
  return {
    f,
    org,
    owner,
    contactId,
    topic,
    links,
    tokenOf,
    contact,
    choice,
    updates,
    post,
  }
}

async function member(f: Fixture) {
  const other = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: other.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  return other
}

describe("unsubscribe tokens", () => {
  const target = { organizationId: "org1", contactId: "c1", topicId: "t1" }

  test("round-trip, without the address or any expiry", async () => {
    const token = await signUnsubscribeToken(target, SECRET)
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(await readUnsubscribeToken(token, SECRET)).toEqual(target)
    const global = await signUnsubscribeToken(
      { organizationId: "org1", contactId: "c1" },
      SECRET
    )
    expect(await readUnsubscribeToken(global, SECRET)).toEqual({
      organizationId: "org1",
      contactId: "c1",
    })
  })

  test("tampered, forged and malformed tokens are refused", async () => {
    const token = await signUnsubscribeToken(target, SECRET)
    const [payload, mac] = token.split(".")
    const retargeted = btoa("org1.c2.t1").replace(/=+$/, "")
    const flipped = mac!.slice(0, -2) + (mac!.endsWith("AA") ? "BB" : "AA")
    for (const bad of [
      `${retargeted}.${mac}`,
      `${payload}.${flipped}`,
      await signUnsubscribeToken(target, "another-server-secret-".repeat(3)),
      "",
      "garbage",
      `${payload}.${mac}.extra`,
      "x".repeat(600),
    ])
      expect(await readUnsubscribeToken(bad, SECRET)).toBeNull()
  })

  test("signing refuses without the server secret", async () => {
    await expect(signUnsubscribeToken(target, "")).rejects.toThrow("secret")
  })
})

describe("sender links", () => {
  test("page URL, one-click URL and RFC 8058 headers", async () => {
    const { links, tokenOf } = await setup()
    const out = await links()
    const token = tokenOf(out.pageUrl)
    expect(out.pageUrl).toBe(`https://opensend.test/unsubscribe/${token}`)
    // One-click goes to the verified public callback origin.
    expect(out.oneClickUrl).toBe(
      `https://api.opensend.test/unsubscribe/${token}`
    )
    expect(out.headers).toEqual({
      "List-Unsubscribe": `<${out.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    })
    expect(out.variables).toEqual({ OPENSEND_UNSUBSCRIBE_URL: out.pageUrl })
    expect(out.pageUrl).not.toContain("ada")
  })

  test("another team's contact or topic is refused", async () => {
    const { f, org, contactId } = await setup()
    const theirTopic = await f.outsider.client.mutation(api.topics.create, {
      organizationId: f.outsider.team,
      name: "Theirs",
      description: "",
      defaultSubscription: "opt_out",
      visibility: "public",
    })
    await expect(
      f.t.run((ctx) =>
        unsubscribeLinks(ctx, { organizationId: f.outsider.team, contactId })
      )
    ).rejects.toThrow("Contact not found")
    await expect(
      f.t.run((ctx) =>
        unsubscribeLinks(ctx, {
          organizationId: org,
          contactId,
          topicId: theirTopic,
        })
      )
    ).rejects.toThrow("Topic not found")
  })
})

describe("one-click unsubscribe", () => {
  test("POST unsubscribes from everything, once, with no redirect", async () => {
    const { links, tokenOf, post, contact, updates } = await setup()
    const token = tokenOf((await links()).oneClickUrl)
    const before = await updates()
    const response = await post(token)
    expect(response.status).toBe(200)
    expect(response.headers.get("location")).toBeNull()
    expect((await contact())!.unsubscribed).toBe(true)
    expect(await updates()).toBe(before + 1)
    // Idempotent: a retry succeeds and changes nothing.
    expect((await post(token)).status).toBe(200)
    expect(await updates()).toBe(before + 1)
  })

  test("a topic link leaves only that topic", async () => {
    const { topic, links, tokenOf, post, contact, choice, updates } =
      await setup()
    const news = await topic("News")
    const token = tokenOf((await links(news)).oneClickUrl)
    const before = await updates()
    expect((await post(token)).status).toBe(200)
    expect(await choice(news)).toBe("unsubscribed")
    expect((await contact())!.unsubscribed).toBe(false)
    expect(await updates()).toBe(before + 1)
    expect((await post(token)).status).toBe(200)
    expect(await updates()).toBe(before + 1)
  })

  test("a multipart body is accepted", async () => {
    const { links, tokenOf, post, contact } = await setup()
    const token = tokenOf((await links()).oneClickUrl)
    const body =
      '--b\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--b--\r\n'
    expect(
      (await post(token, body, "multipart/form-data; boundary=b")).status
    ).toBe(200)
    expect((await contact())!.unsubscribed).toBe(true)
  })

  test("GET, a wrong body or a bad token changes nothing", async () => {
    const { f, links, tokenOf, post, contact, contactId } = await setup()
    const token = tokenOf((await links()).oneClickUrl)
    const opened = await f.t.fetch(`/unsubscribe/${token}`)
    expect(opened.status).toBe(303)
    expect(opened.headers.get("location")).toBe(
      `https://opensend.test/unsubscribe/${token}`
    )
    expect((await post(token, "")).status).toBe(400)
    expect((await post(token, "List-Unsubscribe=Maybe")).status).toBe(400)
    expect((await post(`${token}x`)).status).toBe(404)
    // Signed for another team: the contact is not theirs.
    const crossTeam = await signUnsubscribeToken(
      { organizationId: f.outsider.team, contactId },
      SECRET
    )
    expect((await post(crossTeam)).status).toBe(404)
    expect((await contact())!.unsubscribed).toBe(false)
  })

  test("a flood on one link is rate limited", async () => {
    const { links, tokenOf, post } = await setup()
    const token = tokenOf((await links()).oneClickUrl)
    for (let i = 0; i < 30; i++) expect((await post(token)).status).toBe(200)
    expect((await post(token)).status).toBe(429)
  })
})

describe("preference page", () => {
  test("shows public topics with the contact's standing, never private ones", async () => {
    const { f, owner, topic, links, tokenOf, contactId } = await setup()
    const news = await topic("News")
    const promos = await topic("Promos", "public", "opt_in")
    await topic("Billing", "private")
    await owner.mutation(api.contacts.setTopic, {
      id: contactId,
      topicId: news,
      subscription: "unsubscribed",
    })
    const token = tokenOf((await links()).pageUrl)
    const view = await f.t.query(api.unsubscribe.preferences, { token })
    expect(view).toEqual({
      page: {
        brandName: "owner",
        heading: "Manage your email preferences",
        body: "Choose the topics you still want from this workspace.",
      },
      unsubscribed: false,
      topics: [
        { id: promos, name: "Promos", subscribed: false },
        { id: news, name: "News", subscribed: false },
      ],
    })
    expect(JSON.stringify(view)).not.toContain("ada@example.com")
    expect(
      await f.t.query(api.unsubscribe.preferences, { token: `${token}x` })
    ).toBeNull()
  })

  test("switches respect visibility and team, and emit contact.updated", async () => {
    const { f, topic, links, tokenOf, choice, updates } = await setup()
    const news = await topic("News")
    const billing = await topic("Billing", "private")
    const theirs = await f.outsider.client.mutation(api.topics.create, {
      organizationId: f.outsider.team,
      name: "Theirs",
      description: "",
      defaultSubscription: "opt_out",
      visibility: "public",
    })
    const token = tokenOf((await links()).pageUrl)
    const before = await updates()
    await f.t.mutation(api.unsubscribe.setTopic, {
      token,
      topicId: news,
      subscribed: false,
    })
    expect(await choice(news)).toBe("unsubscribed")
    expect(await updates()).toBe(before + 1)
    // The same choice again is not a change.
    await f.t.mutation(api.unsubscribe.setTopic, {
      token,
      topicId: news,
      subscribed: false,
    })
    expect(await updates()).toBe(before + 1)
    for (const topicId of [billing, theirs, "not-an-id"])
      await expect(
        f.t.mutation(api.unsubscribe.setTopic, {
          token,
          topicId,
          subscribed: false,
        })
      ).rejects.toThrow("Topic not found")
    expect(await choice(billing)).toBeNull()
    await expect(
      f.t.mutation(api.unsubscribe.setSubscribed, {
        token: `${token}x`,
        subscribed: false,
      })
    ).rejects.toThrow("Contact not found")
  })

  test("unsubscribing from everything and back", async () => {
    const { f, links, tokenOf, contact, updates } = await setup()
    const token = tokenOf((await links()).pageUrl)
    const before = await updates()
    await f.t.mutation(api.unsubscribe.setSubscribed, {
      token,
      subscribed: false,
    })
    expect((await contact())!.unsubscribed).toBe(true)
    expect(
      (await f.t.query(api.unsubscribe.preferences, { token }))!.unsubscribed
    ).toBe(true)
    await f.t.mutation(api.unsubscribe.setSubscribed, {
      token,
      subscribed: true,
    })
    expect((await contact())!.unsubscribed).toBe(false)
    expect(await updates()).toBe(before + 2)
  })
})

describe("unsubscribe page settings", () => {
  test("defaults to the team's name; a plain member saves it", async () => {
    const { f, org } = await setup()
    expect(
      await f.owner.client.query(api.unsubscribe.page, { organizationId: org })
    ).toEqual({
      brandName: "owner",
      heading: "Manage your email preferences",
      body: "Choose the topics you still want from this workspace.",
    })
    const m = await member(f)
    await m.client.mutation(api.unsubscribe.savePage, {
      organizationId: org,
      brandName: "  Acme ",
      heading: "Your Acme email",
      body: "",
    })
    const saved = { brandName: "Acme", heading: "Your Acme email", body: "" }
    expect(
      await f.owner.client.query(api.unsubscribe.page, { organizationId: org })
    ).toEqual(saved)
    // Saving again updates the one row.
    await m.client.mutation(api.unsubscribe.savePage, {
      organizationId: org,
      ...saved,
      body: "Pick what you want.",
    })
    expect(
      await f.t.run((ctx) => ctx.db.query("unsubscribePages").collect())
    ).toHaveLength(1)
  })

  test("another team's member is refused", async () => {
    const { f, org } = await setup()
    await expect(
      f.outsider.client.query(api.unsubscribe.page, { organizationId: org })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.mutation(api.unsubscribe.savePage, {
        organizationId: org,
        brandName: "Mine",
        heading: "Mine",
        body: "",
      })
    ).rejects.toThrow("permission")
  })

  test("validation", async () => {
    const { f, org } = await setup()
    const save = (patch: Record<string, string>) =>
      f.owner.client.mutation(api.unsubscribe.savePage, {
        organizationId: org,
        brandName: "Acme",
        heading: "Heading",
        body: "",
        ...patch,
      })
    await expect(save({ brandName: " " })).rejects.toThrow("brand name")
    await expect(save({ brandName: "x".repeat(101) })).rejects.toThrow(
      "brand name"
    )
    await expect(save({ heading: "" })).rejects.toThrow("heading")
    await expect(save({ heading: "x".repeat(201) })).rejects.toThrow("heading")
    await expect(save({ body: "x".repeat(1001) })).rejects.toThrow("body")
  })
})
