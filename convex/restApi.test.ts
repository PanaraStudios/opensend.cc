import { afterEach, describe, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { tokenHash } from "../lib/oauth/policy"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

type Fixture = Awaited<ReturnType<typeof fixture>>

/** A plain member (not an admin) of the owner's team. */
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
const input = (patch: Record<string, unknown> = {}) => ({
  name: "Production",
  permission: "full_access" as const,
  domainId: null,
  ...patch,
})
async function key(f: Fixture, patch: Record<string, unknown> = {}) {
  return f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: input(patch),
  })
}
const call = (
  f: Fixture,
  token: string | null,
  path: string,
  init: RequestInit = {}
) =>
  f.t.fetch(path, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  })

describe("API keys in the dashboard", () => {
  test("a plain member creates, edits and removes keys; the token is shown once and only its hash is kept", async () => {
    const f = await fixture()
    const m = await member(f)
    const created = await m.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: input({ name: "  Deploy  " }),
    })
    expect(created.token).toMatch(/^os_[a-z0-9]{32}$/)
    const stored = await f.t.run((ctx) => ctx.db.get("apiKeys", created.id))
    expect(stored).toMatchObject({
      name: "Deploy",
      tokenHash: await tokenHash(created.token),
      tokenPrefix: created.token.slice(0, 10),
      tokenLast4: created.token.slice(-4),
      createdBy: { name: "member" },
    })
    expect(JSON.stringify(stored)).not.toContain(created.token)
    const page = await m.client.query(api.apiKeys.list, {
      organizationId: f.owner.team,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(page.page).toHaveLength(1)
    expect(page.page[0]).not.toHaveProperty("tokenHash")
    await m.client.mutation(api.apiKeys.update, {
      id: created.id,
      patch: { name: "Renamed" },
    })
    await m.client.mutation(api.apiKeys.remove, { id: created.id })
    expect(await f.t.run((ctx) => ctx.db.get("apiKeys", created.id))).toBeNull()
  })

  test("another team's member is refused", async () => {
    const f = await fixture()
    const { id } = await key(f)
    await expect(
      f.outsider.client.query(api.apiKeys.list, {
        organizationId: f.owner.team,
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.query(api.apiKeys.get, { id })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.action(api.apiKeys.create, {
        organizationId: f.owner.team,
        input: input(),
      })
    ).rejects.toThrow("permission")
    await expect(
      f.outsider.client.mutation(api.apiKeys.remove, { id })
    ).rejects.toThrow("permission")
  })

  test("hasAny tells a team with no keys or logs from one with some", async () => {
    const f = await fixture()
    const team = { organizationId: f.owner.team }
    const has = async () => [
      await f.owner.client.query(api.apiKeys.hasAny, team),
      await f.owner.client.query(api.logs.hasAny, team),
    ]
    expect(await has()).toEqual([false, false])
    const { token } = await key(f)
    expect(await has()).toEqual([true, false])
    await call(f, token, "/api-keys")
    expect(await has()).toEqual([true, true])
    for (const query of [api.apiKeys.hasAny, api.logs.hasAny])
      await expect(f.outsider.client.query(query, team)).rejects.toThrow(
        "permission"
      )
  })

  test("validates names and domains; only sending keys keep a domain", async () => {
    const f = await fixture()
    await expect(key(f, { name: "   " })).rejects.toThrow("Enter a name")
    await expect(key(f, { name: "x".repeat(51) })).rejects.toThrow("50")
    const foreign = await f.t.run(async (ctx) => {
      const domain = (await ctx.db.get("domains", f.domain))!
      const fields = Object.fromEntries(
        Object.entries(domain).filter(([key]) => !key.startsWith("_"))
      ) as Omit<typeof domain, "_id" | "_creationTime">
      return ctx.db.insert("domains", {
        ...fields,
        name: "other.example.test",
        organizationId: f.outsider.team,
      })
    })
    await expect(
      key(f, { permission: "sending_access", domainId: foreign })
    ).rejects.toThrow("Domain not found")
    const full = await key(f, { domainId: f.domain })
    expect(
      (await f.t.run((ctx) => ctx.db.get("apiKeys", full.id)))?.domainId
    ).toBeUndefined()
    const sending = await key(f, {
      permission: "sending_access",
      domainId: f.domain,
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("apiKeys", sending.id)))?.domainId
    ).toBe(f.domain)
  })
})

describe("REST API", () => {
  test("authenticates, refuses bad keys and answers in Resend's error shape", async () => {
    const f = await fixture()
    const missing = await call(f, null, "/api-keys")
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({
      statusCode: 401,
      name: "missing_api_key",
      message: "Missing API key in the authorization header.",
    })
    const invalid = await call(f, "os_notarealkey", "/api-keys")
    expect(invalid.status).toBe(403)
    expect((await invalid.json()).name).toBe("invalid_api_key")
    const unknown = await call(f, "os_x", "/domains/a/b/c")
    expect(unknown.status).toBe(404)
  })

  test("lists and creates keys, with rate-limit headers and a log per request", async () => {
    const f = await fixture()
    const { token, id } = await key(f)
    const listed = await call(f, token, "/api-keys")
    expect(listed.status).toBe(200)
    expect(listed.headers.get("ratelimit-limit")).toBe("10")
    expect(Number(listed.headers.get("ratelimit-remaining"))).toBeLessThan(10)
    const body = await listed.json()
    expect(body).toMatchObject({ object: "list", has_more: false })
    expect(body.data).toEqual([
      expect.objectContaining({ id, name: "Production", last_used_at: null }),
    ])
    const created = await call(f, token, "/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "CI", permission: "sending_access" }),
    })
    expect(created.status).toBe(200)
    const made = await created.json()
    expect(made).toMatchObject({ object: "api_key" })
    expect(made.token).toMatch(/^os_/)
    const logs = await f.owner.client.query(api.logs.list, {
      organizationId: f.owner.team,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(logs.page.map((log) => [log.method, log.path, log.status])).toEqual([
      ["POST", "/api-keys", 200],
      ["GET", "/api-keys", 200],
    ])
    const detail = await f.owner.client.query(api.logs.get, {
      id: logs.page[0]._id,
    })
    expect(detail?.apiKey?._id).toBe(id)
    expect(
      detail?.body?.requestHeaders.find((h) => h.name === "authorization")
        ?.value
    ).toBe("[redacted]")
    expect(JSON.parse(detail!.body!.requestBody!)).toEqual({
      name: "CI",
      permission: "sending_access",
    })
    expect(
      (await f.owner.client.query(api.apiKeys.get, { id }))?.key.lastUsedAt
    ).not.toBeNull()
    await expect(
      f.outsider.client.query(api.logs.get, { id: logs.page[0]._id })
    ).rejects.toThrow("permission")
  })

  test("validates bodies and logs the failure", async () => {
    const f = await fixture()
    const { token } = await key(f)
    const bad = await call(f, token, "/api-keys", {
      method: "POST",
      body: "{not json",
    })
    expect(bad.status).toBe(400)
    const missing = await call(f, token, "/api-keys", {
      method: "POST",
      body: JSON.stringify({ permission: "full_access" }),
    })
    expect(missing.status).toBe(422)
    expect((await missing.json()).name).toBe("missing_required_field")
    const wrong = await call(f, token, "/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "x", permission: "admin" }),
    })
    expect(wrong.status).toBe(422)
    const logs = await f.owner.client.query(api.logs.list, {
      organizationId: f.owner.team,
      statusClass: "4xx",
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(logs.page).toHaveLength(3)
  })

  test("a sending key reaches no full-access endpoint; a key whose domain was removed cannot send", async () => {
    const f = await fixture()
    const sending = await key(f, {
      permission: "sending_access",
      domainId: f.domain,
    })
    const refused = await call(f, sending.token, "/domains")
    expect(refused.status).toBe(401)
    expect((await refused.json()).name).toBe("restricted_api_key")
    const begin = () =>
      f.t.mutation(internal.api.state.begin, {
        credential: { kind: "key", tokenHash: "" },
        permission: "sending",
      })
    await f.t.run((ctx) =>
      ctx.db.patch("apiKeys", sending.id, { tokenHash: "" })
    )
    expect((await begin()).kind).toBe("ok")
    await f.t.run((ctx) => ctx.db.patch("domains", f.domain, { deleted: true }))
    const gone = await begin()
    expect(gone.kind === "error" && gone.error.statusCode).toBe(403)
  })

  test("keeps teams apart: another team's key or domain is not found", async () => {
    const f = await fixture()
    const own = await key(f)
    const theirs = await f.outsider.client.action(api.apiKeys.create, {
      organizationId: f.outsider.team,
      input: input(),
    })
    const removed = await call(f, theirs.token, `/api-keys/${own.id}`, {
      method: "DELETE",
    })
    expect(removed.status).toBe(404)
    expect(await f.t.run((ctx) => ctx.db.get("apiKeys", own.id))).not.toBeNull()
    const domain = await call(f, theirs.token, `/domains/${f.domain}`)
    expect(domain.status).toBe(404)
    const listed = await (await call(f, theirs.token, "/domains")).json()
    expect(listed.data).toEqual([])
    const mine = await call(f, own.token, `/domains/${f.domain}`)
    expect(await mine.json()).toMatchObject({
      object: "domain",
      id: f.domain,
      name: "mail.example.test",
      capabilities: { sending: "enabled", receiving: "disabled" },
    })
  })

  test("pages lists with limit, after and before", async () => {
    const f = await fixture()
    const { token } = await key(f, { name: "k0" })
    for (let i = 1; i < 5; i++) await key(f, { name: `k${i}` })
    const first = await (await call(f, token, "/api-keys?limit=2")).json()
    expect(first.data.map((k: { name: string }) => k.name)).toEqual([
      "k4",
      "k3",
    ])
    expect(first.has_more).toBe(true)
    const next = await (
      await call(f, token, `/api-keys?limit=2&after=${first.data[1].id}`)
    ).json()
    expect(next.data.map((k: { name: string }) => k.name)).toEqual(["k2", "k1"])
    const back = await (
      await call(f, token, `/api-keys?limit=2&before=${next.data[0].id}`)
    ).json()
    expect(back.data.map((k: { name: string }) => k.name)).toEqual(["k4", "k3"])
    expect((await call(f, token, "/api-keys?limit=0")).status).toBe(422)
  })

  test("replays an idempotent POST and refuses the key with another body", async () => {
    const f = await fixture()
    const { token } = await key(f)
    const post = (name: string, idempotencyKey = "create/ci") =>
      call(f, token, "/api-keys", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ name }),
      })
    const first = await (await post("CI")).json()
    const again = await (await post("CI")).json()
    expect(again).toEqual(first)
    const changed = await post("Other")
    expect(changed.status).toBe(409)
    expect((await changed.json()).name).toBe("invalid_idempotent_request")
    expect((await post("CI", "x".repeat(257))).status).toBe(400)
    const keys = await f.owner.client.query(api.apiKeys.list, {
      organizationId: f.owner.team,
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(keys.page.map((k) => k.name).sort()).toEqual(["CI", "Production"])
  })

  test("rate-limits a team to 10 requests a second", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.parse("2026-09-28T12:00:00.000Z"))
    const f = await fixture()
    const { token } = await key(f)
    for (let i = 0; i < 10; i++)
      expect((await call(f, token, "/api-keys")).status).toBe(200)
    const limited = await call(f, token, "/api-keys")
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("1")
    expect((await limited.json()).name).toBe("rate_limit_exceeded")
    vi.setSystemTime(Date.parse("2026-09-28T12:00:01.500Z"))
    expect((await call(f, token, "/api-keys")).status).toBe(200)
  })
})

describe("logs retention", () => {
  test("drops logs older than 30 days with their bodies", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(Date.parse("2026-08-01T00:00:00.000Z"))
    const f = await fixture()
    const { token } = await key(f)
    await call(f, token, "/api-keys")
    vi.setSystemTime(Date.parse("2026-09-28T00:00:00.000Z"))
    await call(f, token, "/api-keys")
    await f.t.mutation(internal.logs.prune, {})
    const left = await f.t.run(async (ctx) => ({
      logs: await ctx.db.query("apiLogs").take(10),
      bodies: await ctx.db.query("apiLogBodies").take(10),
    }))
    expect(left.logs).toHaveLength(1)
    expect(left.bodies).toHaveLength(1)
  })
})
