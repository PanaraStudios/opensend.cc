import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import type { Id } from "./_generated/dataModel"

const dns = vi.hoisted(() => ({ txt: vi.fn() }))
vi.mock("./ses/dns", () => ({
  lookups: () => ({ resolveTxt: dns.txt }),
  authoritativeLookups: async () => undefined,
}))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32))
  vi.stubEnv("BETTER_AUTH_SECRET", "domain-claim-test")
  vi.stubEnv("SITE_URL", "https://opensend.test")
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("No test network"))
  )
  dns.txt.mockReset().mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
async function setup() {
  const f = await fixture()
  await f.t.run((ctx) =>
    patchRow(ctx, "domains", f.domain, {
      status: "verified",
      verifiedAt: Date.now(),
    })
  )
  const args = {
    organizationId: f.outsider.team,
    name: "mail.example.test",
    region: "us-east-1" as const,
    customReturnPath: "send",
  }
  const create = () => f.outsider.client.mutation(api.domainClaims.create, args)
  const get = (id: string) =>
    f.outsider.client.query(api.domainClaims.get, {
      organizationId: f.outsider.team,
      id,
    })
  async function verify(id: Id<"domains">) {
    await f.outsider.client.mutation(api.domainClaims.verify, {
      organizationId: f.outsider.team,
      id,
    })
    const claim = await f.t.run((ctx) =>
      ctx.db
        .query("domainClaims")
        .withIndex("by_domainId", (q) => q.eq("domainId", id))
        .first()
    )
    if (claim?.checkingAt)
      await f.t.action(internal.ses.claimDns.verify, {
        id: claim._id,
        checkingAt: claim.checkingAt,
      })
    return get(id)
  }
  return { ...f, args, create, get, verify }
}

describe("domain claims", () => {
  test("reserves a non-sending placeholder, resumes it, and requires an existing foreign verified domain", async () => {
    const f = await setup()
    const claim = await f.create()
    expect(claim).toMatchObject({
      object: "domain_claim",
      status: "pending",
      name: f.args.name,
      blocked_reason: null,
      failure_reason: null,
    })
    expect(claim.record).toMatchObject({
      type: "TXT",
      name: f.args.name,
      ttl: "Auto",
    })
    expect(Date.parse(claim.expires_at) - Date.parse(claim.created_at)).toBe(
      7 * 86400000
    )
    expect(await f.create()).toEqual(claim)
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", claim.domain_id))
    ).toMatchObject({
      claimPending: true,
      sending: false,
      phase: "pending",
      records: [],
    })
    await expect(
      f.outsider.client.mutation(api.domains.create, f.args)
    ).rejects.toThrow("registered already")
    await expect(
      f.outsider.client.mutation(api.domainClaims.create, {
        ...f.args,
        name: "missing.test",
      })
    ).rejects.toThrow("Only a domain verified")
    await expect(
      f.owner.client.mutation(api.domainClaims.create, {
        ...f.args,
        organizationId: f.owner.team,
      })
    ).rejects.toThrow("Only a domain verified")
    await expect(
      f.outsider.client.mutation(api.domains.refresh, { id: claim.domain_id })
    ).rejects.toThrow("Verify the domain claim")
    await expect(
      f.outsider.client.mutation(api.domains.update, {
        id: claim.domain_id,
        sending: true,
      })
    ).rejects.toThrow("claim is in progress")
  })
  test("checks exact TXT content on the server, joining DNS chunks, and transfers through the existing workflow completions", async () => {
    const f = await setup()
    const claim = await f.create()
    dns.txt.mockResolvedValue([[claim.record.value.toUpperCase()]])
    expect(await f.verify(claim.domain_id)).toMatchObject({ status: "pending" })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", f.domain))
    ).toMatchObject({ sending: true, deleted: false })
    dns.txt.mockResolvedValue([
      [claim.record.value.slice(0, 20), claim.record.value.slice(20)],
    ])
    expect(await f.verify(claim.domain_id)).toMatchObject({
      status: "verified",
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", f.domain))
    ).toMatchObject({ sending: false, operation: "remove", phase: "running" })
    await expect(
      f.outsider.client.mutation(api.domains.remove, { id: claim.domain_id })
    ).rejects.toThrow("transfer is in progress")
    await f.t.mutation(internal.domains.finish, {
      id: f.domain,
      changes: { deleted: true, tenantAssociated: false, status: "pending" },
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", claim.domain_id))
    ).toMatchObject({ operation: "provision", phase: "running" })
    await f.t.mutation(internal.domains.finish, {
      id: claim.domain_id,
      changes: {
        records: [
          {
            id: "new-dkim",
            kind: "DKIM",
            type: "CNAME",
            name: "new._domainkey.mail.example.test",
            value: "new.dkim.amazonses.com",
            ttl: "Auto",
            status: "pending",
          },
        ],
      },
    })
    expect(await f.get(claim.domain_id)).toMatchObject({ status: "completed" })
    expect(
      await f.owner.client.query(api.domains.get, { id: f.domain })
    ).toBeNull()
    const events = await f.t.run((ctx) => ctx.db.query("events").take(100))
    expect(
      events.filter(
        (e) => e.organizationId === f.owner.team && e.type === "domain.deleted"
      )
    ).toHaveLength(1)
    expect(
      events
        .filter((e) => e.organizationId === f.outsider.team)
        .map((e) => e.type)
    ).toContain("domain.created")
    expect(
      events
        .filter((e) => e.organizationId === f.outsider.team)
        .map((e) => e.type)
    ).toContain("domain.updated")
    await f.t.mutation(internal.domains.finish, {
      id: f.domain,
      changes: { deleted: true },
    })
    expect(
      (await f.t.run((ctx) => ctx.db.query("events").take(100))).filter(
        (e) => e.type === "domain.deleted"
      )
    ).toHaveLength(1)
  })
  test.each(["queued", "scheduled"] as const)(
    "blocks %s mail and retries after cancellation",
    async (status) => {
      const f = await setup()
      const claim = await f.create()
      const email = await f.t.run((ctx) =>
        insertRow(ctx, "emails", {
          organizationId: f.owner.team,
          domainId: f.domain,
          from: "a@mail.example.test",
          to: ["to@example.test"],
          subject: "Pending",
          status,
          source: "api",
          generation: 1,
          attempts: 0,
          search: "pending",
        })
      )
      dns.txt.mockResolvedValue([[claim.record.value]])
      expect(await f.verify(claim.domain_id)).toMatchObject({
        status: "blocked",
        blocked_reason: "pending_scheduled_emails",
      })
      await f.t.run((ctx) =>
        patchRow(ctx, "emails", email, { status: "canceled" })
      )
      expect(await f.verify(claim.domain_id)).toMatchObject({
        status: "verified",
        blocked_reason: null,
      })
    }
  )
  test.each(["running", "remove", "imported"])(
    "blocks unsafe owner state: %s",
    async (state) => {
      const f = await setup()
      const claim = await f.create()
      await f.t.run((ctx) =>
        patchRow(
          ctx,
          "domains",
          f.domain,
          state === "running"
            ? { phase: "running" }
            : state === "remove"
              ? { operation: "remove", phase: "failed" }
              : { adoption: { approved: true, fingerprint: "imported" } }
        )
      )
      dns.txt.mockResolvedValue([[claim.record.value]])
      expect(await f.verify(claim.domain_id)).toMatchObject({
        status: "blocked",
        blocked_reason: "recent_owner_activity",
      })
    }
  )
  test("expires proof and renews with a new token; stale DNS cannot transfer it", async () => {
    const f = await setup()
    const claim = await f.create()
    await f.outsider.client.mutation(api.domainClaims.verify, {
      organizationId: f.outsider.team,
      id: claim.domain_id,
    })
    const row = (await f.t.run((ctx) => ctx.db.get("domainClaims", claim.id)))!
    vi.setSystemTime(Date.now() + 7 * 86400000 + 1)
    await f.t.mutation(components.betterAuth.adapter.updateOne, {
      input: {
        model: "session",
        where: [{ field: "_id", value: f.outsider.session._id }],
        update: { expiresAt: Date.now() + 3600000 },
      },
    })
    expect(await f.get(claim.domain_id)).toMatchObject({ status: "expired" })
    await f.t.mutation(internal.domainClaims.acceptProof, {
      id: claim.id,
      checkingAt: row.checkingAt!,
      matches: true,
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", f.domain))
    ).toMatchObject({ sending: true })
    // Refresh the auth session after advancing past its lifetime.

    const renewed = await f.create()
    expect(renewed.record.value).not.toBe(claim.record.value)
    expect(
      await f.t.run((ctx) => ctx.db.get("domainClaims", claim.id))
    ).toMatchObject({ status: "superseded" })
  })
  test("cancels by deleting only the placeholder; pending jobs cannot touch the owner", async () => {
    const f = await setup()
    const claim = await f.create()
    await f.outsider.client.mutation(api.domains.remove, {
      id: claim.domain_id,
    })
    expect(await f.get(claim.domain_id)).toBeNull()
    expect(
      await f.t.run((ctx) => ctx.db.get("domainClaims", claim.id))
    ).toMatchObject({ status: "canceled" })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", f.domain))
    ).toMatchObject({ sending: true, deleted: false })
  })
  test("plain members can claim; installation admins cannot bypass team access", async () => {
    const f = await setup()
    const member = await f.actor("claim-member")
    await f.t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: {
          organizationId: f.outsider.team,
          userId: member.user._id,
          role: "member",
          createdAt: Date.now(),
        },
      },
    })
    const claim = await member.client.mutation(api.domainClaims.create, f.args)
    await expect(
      f.owner.client.query(api.domainClaims.get, {
        organizationId: f.outsider.team,
        id: claim.domain_id,
      })
    ).rejects.toThrow(/permission/i)
    await expect(
      f.owner.client.mutation(api.domainClaims.verify, {
        organizationId: f.outsider.team,
        id: claim.domain_id,
      })
    ).rejects.toThrow(/permission/i)
    expect(
      await f.owner.client.query(api.domainClaims.get, {
        organizationId: f.owner.team,
        id: claim.domain_id,
      })
    ).toBeNull()
  })
  test("serializes competing claims and preserves the lock on AWS failure for retry", async () => {
    const f = await setup()
    const claim = await f.create()
    dns.txt.mockResolvedValue([[claim.record.value]])
    await f.verify(claim.domain_id)
    await f.t.mutation(internal.domains.finish, {
      id: f.domain,
      changes: {},
      error: "SES unavailable",
    })
    expect(await f.get(claim.domain_id)).toMatchObject({
      status: "verified",
      failure_reason: "SES unavailable",
    })
    await expect(
      f.owner.client.mutation(api.domains.refresh, { id: f.domain })
    ).rejects.toThrow("transfer is in progress")
    expect(await f.verify(claim.domain_id)).toMatchObject({
      status: "verified",
      failure_reason: null,
    })
    expect(
      await f.t.run((ctx) => ctx.db.get("domains", f.domain))
    ).toMatchObject({ operation: "remove", phase: "running", sending: false })
  })
})
