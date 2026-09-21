/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest"
import { convexTest } from "convex-test"
import workflowTest from "@convex-dev/workflow/test"
import rateLimiterTest from "@convex-dev/rate-limiter/test"
import { Route53Client } from "@aws-sdk/client-route-53"
import schema from "./schema"
import authSchema from "./betterAuth/schema"
import { api, components } from "./_generated/api"
import type { Doc } from "./_generated/dataModel"
import {
  parseTxtValue,
  planDnsWrites,
  quoteTxtValue,
  requireCloudflareToken,
  zoneCandidates,
  type ExistingRecord,
} from "./ses/dnsWriters"

type StoredRecord = Doc<"domains">["records"][number]

const modules = import.meta.glob("./**/*.ts")
const authModules = import.meta.glob("./betterAuth/**/*.ts")
const NAME = "mail.example.test"
const ZONE = "0123456789abcdef0123456789abcdef"
const TOKEN = "cf-token-value-0123456789"
const record = (
  over: Partial<StoredRecord> & Pick<StoredRecord, "id" | "kind" | "type">
): StoredRecord => ({
  name: NAME,
  value: "",
  ttl: "300",
  status: "pending",
  ...over,
})
const dkim = record({
  id: "tok",
  kind: "DKIM",
  type: "CNAME",
  name: `tok._domainkey.${NAME}`,
  value: "tok.dkim.amazonses.com",
})
const mx = record({
  id: "mail-from-mx",
  kind: "MX",
  type: "MX",
  name: `send.${NAME}`,
  value: "feedback-smtp.us-east-1.amazonses.com",
  priority: 10,
})
const spf = record({
  id: "mail-from-spf",
  kind: "SPF",
  type: "TXT",
  name: `send.${NAME}`,
  value: "v=spf1 include:amazonses.com ~all",
})
const dmarc = record({
  id: "dmarc",
  kind: "DMARC",
  type: "TXT",
  name: `_dmarc.${NAME}`,
  value: "v=DMARC1; p=none;",
})
const receiving = record({
  id: "receiving",
  kind: "Receiving",
  type: "MX",
  value: "inbound-smtp.us-east-1.amazonses.com",
  priority: 10,
})
const records = [dkim, mx, spf, dmarc, receiving]

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("DNS write planning", () => {
  test("creates every missing record on an empty zone", () => {
    const plan = planDnsWrites(records, [])
    expect(plan.writes.map((w) => w.record.id)).toEqual([
      "tok",
      "mail-from-mx",
      "mail-from-spf",
      "dmarc",
      "receiving",
    ])
    expect(plan.writes.every((w) => w.preserve.length === 0)).toBe(true)
    expect(plan).toMatchObject({ skipped: 0, conflicts: [] })
  })
  test("skips records already verified without reading the zone", () => {
    const plan = planDnsWrites(
      records.map((r) => ({ ...r, status: "verified" })),
      [{ name: NAME, type: "MX", value: "aspmx.l.google.com", priority: 1 }]
    )
    expect(plan).toEqual({ writes: [], skipped: 5, conflicts: [] })
  })
  test("skips records already published with the right value", () => {
    const existing: ExistingRecord[] = [
      { name: dkim.name, type: "CNAME", value: "TOK.dkim.amazonses.com." },
      { name: mx.name, type: "MX", value: mx.value, priority: 10 },
      {
        name: spf.name,
        type: "TXT",
        value: "v=spf1 include:amazonses.com -all",
      },
      { name: dmarc.name, type: "TXT", value: "v=DMARC1; p=reject;" },
      { name: NAME, type: "MX", value: receiving.value, priority: 10 },
    ]
    expect(planDnsWrites(records, existing)).toEqual({
      writes: [],
      skipped: 5,
      conflicts: [],
    })
  })
  test("reports a different CNAME instead of replacing it", () => {
    const plan = planDnsWrites(
      [dkim],
      [{ name: dkim.name, type: "CNAME", value: "elsewhere.example.net" }]
    )
    expect(plan.writes).toEqual([])
    expect(plan.conflicts).toEqual([
      {
        name: dkim.name,
        type: "CNAME",
        reason:
          "A different record already answers this name. Remove it before running automatic setup.",
      },
    ])
  })
  test("never edits an existing SPF policy, but preserves unrelated TXT values", () => {
    const foreign = planDnsWrites(
      [spf],
      [
        {
          name: spf.name,
          type: "TXT",
          value: "v=spf1 include:sendgrid.net ~all",
        },
      ]
    )
    expect(foreign.writes).toEqual([])
    expect(foreign.conflicts[0].reason).toContain("include:amazonses.com")
    const unrelated = planDnsWrites(
      [spf],
      [{ name: spf.name, type: "TXT", value: "google-site-verification=abc" }]
    )
    expect(unrelated.conflicts).toEqual([])
    expect(unrelated.writes[0].preserve).toEqual([
      "google-site-verification=abc",
    ])
  })
  test("never overwrites an existing DMARC policy", () => {
    expect(
      planDnsWrites(
        [dmarc],
        [{ name: dmarc.name, type: "TXT", value: "v=DMARC1; p=quarantine;" }]
      )
    ).toMatchObject({ writes: [], skipped: 1, conflicts: [] })
  })
  test("refuses to touch an apex already handled by another mail provider", () => {
    const plan = planDnsWrites(
      [receiving],
      [
        { name: NAME, type: "MX", value: "aspmx.l.google.com", priority: 1 },
        {
          name: NAME,
          type: "MX",
          value: "alt1.aspmx.l.google.com",
          priority: 5,
        },
      ]
    )
    expect(plan.writes).toEqual([])
    expect(plan.conflicts).toEqual([
      {
        name: NAME,
        type: "MX",
        reason:
          "Existing MX records handle mail for this domain. Replace them manually to receive with Opensend.",
      },
    ])
  })
  test("refuses a CNAME beside another type, and any record beside a CNAME", () => {
    // Route 53 rejects the whole batch for this and Cloudflare fails part-way
    // through, so the planner has to catch it before either writes anything.
    const blocked = planDnsWrites(
      [dkim],
      [{ name: dkim.name, type: "A", value: "203.0.113.10" }]
    )
    expect(blocked.writes).toEqual([])
    expect(blocked.conflicts[0]).toMatchObject({
      name: dkim.name,
      type: "CNAME",
    })
    expect(blocked.conflicts[0].reason).toContain("cannot coexist")
    for (const desired of [mx, spf, dmarc, receiving]) {
      const plan = planDnsWrites(
        [desired],
        [{ name: desired.name, type: "CNAME", value: "elsewhere.example.net" }]
      )
      expect(plan.writes).toEqual([])
      expect(plan.conflicts[0].reason).toContain("A CNAME already answers")
    }
    // A record already published stays a skip, whatever else shares the name.
    expect(
      planDnsWrites(
        [dkim],
        [
          { name: dkim.name, type: "CNAME", value: `${dkim.value}.` },
          { name: dkim.name, type: "A", value: "203.0.113.10" },
        ]
      )
    ).toMatchObject({ writes: [], skipped: 1, conflicts: [] })
  })
  test("treats a mismatched return-path MX as a conflict, not an edit", () => {
    const plan = planDnsWrites(
      [mx],
      [{ name: mx.name, type: "MX", value: mx.value, priority: 20 }]
    )
    expect(plan.writes).toEqual([])
    expect(plan.conflicts[0].reason).toContain("Different MX records")
  })
})

describe("DNS value and zone helpers", () => {
  test("quotes and splits TXT values into 255-character chunks", () => {
    expect(quoteTxtValue("v=spf1 ~all")).toBe('"v=spf1 ~all"')
    const long = "a".repeat(300)
    expect(quoteTxtValue(long)).toBe(`"${"a".repeat(255)}" "${"a".repeat(45)}"`)
    expect(parseTxtValue(quoteTxtValue(long))).toBe(long)
    expect(parseTxtValue('"part one" "part two"')).toBe("part onepart two")
    expect(parseTxtValue("unquoted")).toBe("unquoted")
    expect(parseTxtValue(quoteTxtValue('say "hi"'))).toBe('say "hi"')
  })
  test("walks parent zones without ever querying a bare TLD", () => {
    expect(zoneCandidates("a.b.example.test.")).toEqual([
      "a.b.example.test",
      "b.example.test",
      "example.test",
    ])
    expect(zoneCandidates("example.test")).toEqual(["example.test"])
    expect(zoneCandidates("test")).toEqual([])
  })
  test("rejects a missing or malformed Cloudflare token", () => {
    expect(requireCloudflareToken(` ${TOKEN} `)).toBe(TOKEN)
    for (const bad of [undefined, "", "short", `${TOKEN} extra`])
      expect(() => requireCloudflareToken(bad)).toThrow("Cloudflare API token")
  })
})

async function fixture(dnsProvider: "cloudflare" | "route53") {
  const t = convexTest(schema, modules)
  t.registerComponent("betterAuth", authSchema, authModules)
  workflowTest.register(t)
  rateLimiterTest.register(t)
  async function actor(name: string, bootstrap = false) {
    const user = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name,
          email: `${name}@example.test`,
          emailVerified: true,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    })
    const session = await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: user._id,
          token: name,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + 3600000,
        },
      },
    })
    if (bootstrap)
      await t.mutation(components.betterAuth.policy.admitUser, {
        userId: user._id,
        email: user.email,
      })
    const client = t.withIdentity({ subject: user._id, sessionId: session._id })
    const team = await t.mutation(components.betterAuth.teams.create, {
      name,
      sessionId: session._id,
    })
    return { client, team }
  }
  const owner = await actor("owner", true)
  const outsider = await actor("outsider")
  const installation = await t.run((ctx) =>
    ctx.db.insert("installation", {
      key: "installation",
      siteUrl: "https://opensend.test",
      callbackOrigin: "https://api.opensend.test",
      environmentCheckedAt: Date.now(),
      completedAt: Date.now(),
      credentialRevision: 1,
      accountId: "123456789012",
      credentialKind: "role",
      defaultRegion: "us-east-1",
    })
  )
  const domain = await t.run((ctx) =>
    ctx.db.insert("domains", {
      organizationId: owner.team,
      name: NAME,
      region: "us-east-1",
      customReturnPath: "send",
      status: "pending",
      phase: "ready",
      deleted: false,
      sending: true,
      tls: "opportunistic",
      records,
      dnsProvider,
      sesVerified: false,
      dkimVerified: false,
      mailFromVerified: false,
      operation: "provision",
    })
  )
  const configure = (cloudflareToken?: string) =>
    owner.client.action(api.ses.dnsAutoConfig.configure, {
      id: domain,
      cloudflareToken,
    })
  const history = () =>
    t.run(async (ctx) =>
      (
        await ctx.db
          .query("domainHistory")
          .withIndex("by_domainId", (q) => q.eq("domainId", domain))
          .take(10)
      ).map((row) => row.message)
    )
  const saved = () =>
    t.run(async (ctx) => (await ctx.db.get("domains", domain))!)
  return { t, owner, outsider, installation, domain, configure, history, saved }
}

type Zone = { name: string; rows: Record<string, unknown>[] }
function cloudflareApi(zone: Zone | null) {
  const posts: Record<string, unknown>[] = []
  const calls: { url: string; authorization: string | null }[] = []
  const ok = (result: unknown) =>
    new Response(JSON.stringify({ success: true, result, errors: [] }))
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      calls.push({
        url: `${url.pathname}${url.search}`,
        authorization: new Headers(init?.headers).get("authorization"),
      })
      if (url.pathname === "/client/v4/zones")
        return ok(
          zone && url.searchParams.get("name") === zone.name
            ? [{ id: ZONE, name: zone.name }]
            : []
        )
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)))
        return ok({ id: "created" })
      }
      const name = url.searchParams.get("name")
      return ok(zone?.rows.filter((row) => row.name === name) ?? [])
    })
  return { posts, calls, fetcher }
}

describe("automatic DNS setup on Cloudflare", () => {
  test("creates every record in the parent zone and queues a recheck", async () => {
    const f = await fixture("cloudflare")
    const api = cloudflareApi({ name: "example.test", rows: [] })
    expect(await f.configure(TOKEN)).toEqual({
      created: 5,
      skipped: 0,
      conflicts: [],
    })
    expect(api.calls.map((call) => call.url).slice(0, 2)).toEqual([
      `/client/v4/zones?name=${NAME}`,
      "/client/v4/zones?name=example.test",
    ])
    expect(api.calls.every((c) => c.authorization === `Bearer ${TOKEN}`)).toBe(
      true
    )
    expect(api.posts).toContainEqual({
      type: "CNAME",
      name: dkim.name,
      content: dkim.value,
      ttl: 300,
      proxied: false,
    })
    expect(api.posts).toContainEqual({
      type: "MX",
      name: NAME,
      content: receiving.value,
      ttl: 300,
      priority: 10,
    })
    expect(api.posts).toContainEqual({
      type: "TXT",
      name: dmarc.name,
      content: dmarc.value,
      ttl: 300,
    })
    expect(await f.history()).toEqual([
      "5 DNS records written to Cloudflare",
      "refresh requested",
    ])
    expect(await f.saved()).toMatchObject({
      phase: "running",
      operation: "refresh",
    })
  })
  test("retries a failed provision as a provision, never as a refresh", async () => {
    const f = await fixture("cloudflare")
    cloudflareApi({ name: "example.test", rows: [] })
    // A failed provision keeps its adoption review reachable; queueing a
    // refresh instead would lock the administrator out of it.
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, {
        phase: "failed",
        operation: "provision",
        error: "This domain already exists in SES.",
      })
    )
    expect(await f.configure(TOKEN)).toMatchObject({ created: 5 })
    expect(await f.saved()).toMatchObject({
      phase: "running",
      operation: "provision",
    })
    expect(await f.history()).toEqual([
      "5 DNS records written to Cloudflare",
      "provision requested",
    ])
  })
  test("reports conflicts, skips settled records and writes nothing else", async () => {
    const f = await fixture("cloudflare")
    const api = cloudflareApi({
      name: "example.test",
      rows: [
        { name: dkim.name, type: "CNAME", content: "elsewhere.example.net" },
        { name: spf.name, type: "TXT", content: '"v=spf1 include:other.test"' },
        { name: dmarc.name, type: "TXT", content: "v=DMARC1; p=reject;" },
        { name: NAME, type: "MX", content: "aspmx.l.google.com", priority: 1 },
      ],
    })
    const result = await f.configure(TOKEN)
    expect(result).toMatchObject({ created: 1, skipped: 1 })
    expect(result.conflicts.map((c) => `${c.type} ${c.name}`)).toEqual([
      `CNAME ${dkim.name}`,
      `TXT ${spf.name}`,
      `MX ${NAME}`,
    ])
    expect(result.conflicts[2].reason).toContain("Replace them manually")
    expect(api.posts).toEqual([
      {
        type: "MX",
        name: mx.name,
        content: mx.value,
        ttl: 300,
        priority: 10,
      },
    ])
    expect(await f.history()).toEqual([
      "1 DNS records written to Cloudflare",
      "refresh requested",
    ])
  })
  test("explains a rejected token and never echoes it", async () => {
    const f = await fixture("cloudflare")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 403 })
    )
    await expect(f.configure(TOKEN)).rejects.toThrow(
      "Cloudflare rejected this token"
    )
    await expect(f.configure(TOKEN)).rejects.not.toThrow(TOKEN)
    await expect(f.configure()).rejects.toThrow("Cloudflare API token")
    expect(await f.history()).toEqual([])
  })
  test("reports a zone this token cannot see", async () => {
    const f = await fixture("cloudflare")
    cloudflareApi(null)
    await expect(f.configure(TOKEN)).rejects.toThrow("can't see a Cloudflare")
  })
})

type RecordSet = {
  Name: string
  Type: string
  ResourceRecords?: { Value: string }[]
}
function route53Api(sets: RecordSet[], fail?: string) {
  const state = { changes: [] as Record<string, unknown>[] }
  vi.spyOn(Route53Client.prototype, "send").mockImplementation(
    async (command) => {
      const name = command.constructor.name
      const input = command.input as Record<string, string>
      if (fail) throw Object.assign(new Error("denied"), { name: fail })
      if (name === "ListHostedZonesByNameCommand")
        return {
          HostedZones:
            input.DNSName === "example.test"
              ? [
                  {
                    Id: "/hostedzone/Z1",
                    Name: "example.test.",
                    Config: { PrivateZone: false },
                  },
                  // A private zone with the same name must never be chosen.
                  {
                    Id: "/hostedzone/Z2",
                    Name: "example.test.",
                    Config: { PrivateZone: true },
                  },
                ]
              : [],
        } as never
      if (name === "ListResourceRecordSetsCommand")
        return {
          ResourceRecordSets: sets.filter(
            (set) => set.Name.replace(/\.$/, "") === input.StartRecordName
          ),
        } as never
      state.changes = (
        command.input as { ChangeBatch: { Changes: Record<string, unknown>[] } }
      ).ChangeBatch.Changes
      return {} as never
    }
  )
  return state
}

describe("automatic DNS setup on Route 53", () => {
  test("writes one batch into the longest public hosted zone", async () => {
    const f = await fixture("route53")
    const aws = route53Api([])
    expect(await f.configure()).toEqual({
      created: 5,
      skipped: 0,
      conflicts: [],
    })
    expect(aws.changes).toHaveLength(5)
    expect(aws.changes.every((change) => change.Action === "CREATE")).toBe(true)
    expect(aws.changes).toContainEqual({
      Action: "CREATE",
      ResourceRecordSet: {
        Name: dmarc.name,
        Type: "TXT",
        TTL: 300,
        ResourceRecords: [{ Value: '"v=DMARC1; p=none;"' }],
      },
    })
    expect(aws.changes).toContainEqual({
      Action: "CREATE",
      ResourceRecordSet: {
        Name: NAME,
        Type: "MX",
        TTL: 300,
        ResourceRecords: [{ Value: `10 ${receiving.value}` }],
      },
    })
    expect(await f.history()).toEqual([
      "5 DNS records written to Route 53",
      "refresh requested",
    ])
  })
  test("preserves unrelated TXT values and reports conflicting sets", async () => {
    const f = await fixture("route53")
    const aws = route53Api([
      {
        Name: `${spf.name}.`,
        Type: "TXT",
        ResourceRecords: [{ Value: '"google-site-verification=abc"' }],
      },
      {
        Name: `${dkim.name}.`,
        Type: "CNAME",
        ResourceRecords: [{ Value: "tok.dkim.amazonses.com." }],
      },
      {
        Name: `${NAME}.`,
        Type: "MX",
        ResourceRecords: [{ Value: "1 aspmx.l.google.com." }],
      },
    ])
    const result = await f.configure()
    expect(result).toMatchObject({ created: 3, skipped: 1 })
    expect(result.conflicts).toEqual([
      {
        name: NAME,
        type: "MX",
        reason:
          "Existing MX records handle mail for this domain. Replace them manually to receive with Opensend.",
      },
    ])
    expect(aws.changes).toContainEqual({
      Action: "UPSERT",
      ResourceRecordSet: {
        Name: spf.name,
        Type: "TXT",
        TTL: 300,
        ResourceRecords: [
          { Value: '"google-site-verification=abc"' },
          { Value: `"${spf.value}"` },
        ],
      },
    })
  })
  test("names the optional IAM permissions when AWS denies the write", async () => {
    const f = await fixture("route53")
    route53Api([], "AccessDeniedException")
    await expect(f.configure()).rejects.toThrow(
      "route53:ChangeResourceRecordSets"
    )
    expect(await f.history()).toEqual([])
  })
  test("reports a missing hosted zone instead of guessing one", async () => {
    const f = await fixture("route53")
    vi.spyOn(Route53Client.prototype, "send").mockResolvedValue({
      HostedZones: [],
    } as never)
    await expect(f.configure()).rejects.toThrow(
      "no public Route 53 hosted zone"
    )
  })
})

describe("automatic DNS setup authorization", () => {
  test("denies another team and unsupported providers", async () => {
    const f = await fixture("route53")
    await expect(
      f.outsider.client.action(api.ses.dnsAutoConfig.configure, {
        id: f.domain,
      })
    ).rejects.toThrow("permission")
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { dnsProvider: "godaddy" })
    )
    await expect(f.configure()).rejects.toThrow(
      "isn't available for this provider"
    )
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { dnsProvider: "route53", records: [] })
    )
    await expect(f.configure()).rejects.toThrow("no DNS records yet")
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { records, phase: "running" })
    )
    await expect(f.configure()).rejects.toThrow("already running")
  })
  test("route53 refuses a team admin who is not an installation admin", async () => {
    const f = await fixture("route53")
    const send = vi
      .spyOn(Route53Client.prototype, "send")
      .mockResolvedValue({} as never)
    // The outsider owns this team, so only the installation check can stop them.
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { organizationId: f.outsider.team })
    )
    await expect(
      f.outsider.client.action(api.ses.dnsAutoConfig.configure, {
        id: f.domain,
      })
    ).rejects.toThrow("Only an installation admin can write to Route 53")
    expect(send).not.toHaveBeenCalled()
    expect((await f.saved()).dnsWriteClaimedAt).toBeUndefined()
    send.mockRestore()
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { organizationId: f.owner.team })
    )
    route53Api([])
    expect(await f.configure()).toMatchObject({ created: 5 })
  })
  test("a second run is refused while the first holds the claim", async () => {
    const f = await fixture("cloudflare")
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, { dnsWriteClaimedAt: Date.now() })
    )
    const api = cloudflareApi({ name: "example.test", rows: [] })
    await expect(f.configure(TOKEN)).rejects.toThrow(
      "Automatic DNS setup is already running for this domain"
    )
    expect(api.posts).toEqual([])
    // A stale claim never blocks forever, and a finished run releases its own.
    await f.t.run((ctx) =>
      ctx.db.patch("domains", f.domain, {
        dnsWriteClaimedAt: Date.now() - 130000,
      })
    )
    expect(await f.configure(TOKEN)).toMatchObject({ created: 5 })
    expect((await f.saved()).dnsWriteClaimedAt).toBeUndefined()
  })
  test("a failed run releases the claim without recording history", async () => {
    const f = await fixture("cloudflare")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 403 })
    )
    await expect(f.configure(TOKEN)).rejects.toThrow(
      "Cloudflare rejected this token"
    )
    expect((await f.saved()).dnsWriteClaimedAt).toBeUndefined()
    expect(await f.history()).toEqual([])
  })
})
