import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import { POLICY_REVISION } from "./ses/contracts"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"
import { patchRow } from "./counts"

beforeEach(() => vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32)))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function behindFixture() {
  const f = await fixture()
  await storeTestCredentials(f)
  await f.t.run((ctx) =>
    ctx.db.patch("installation", f.installation, { policyRevision: undefined })
  )
  const revision = async () =>
    (await f.owner.client.query(api.installation.status)).installation
      ?.policyRevision
  return { ...f, revision }
}
describe("AWS policy revision", () => {
  test("send context refuses until the current permissions are recorded", async () => {
    const f = await fixture()
    await f.t.run(async (ctx) => {
      await patchRow(ctx, "domains", f.domain, {
        status: "verified",
        tenantAssociated: true,
        configurationSet: "team-configuration",
      })
      await ctx.db.patch("sesRegions", f.region._id, {
        callbackConfirmed: true,
        quota: { ...f.region.quota, production: true },
      })
    })
    const sendContext = () =>
      f.t.query(internal.ses.sendContext.get, {
        organizationId: f.owner.team,
        domainId: f.domain,
      })
    await expect(sendContext()).resolves.toMatchObject({
      TenantName: f.tenantName,
    })
    for (const policyRevision of [undefined, POLICY_REVISION - 1]) {
      await f.t.run((ctx) =>
        ctx.db.patch("installation", f.installation, { policyRevision })
      )
      await expect(sendContext()).rejects.toThrow(
        "Ask your administrator to update AWS permissions"
      )
    }
  })
  test("only the super admin can see the revision", async () => {
    const f = await behindFixture()
    const member = await f.outsider.client.query(api.installation.status)
    expect(member.installation?.policyRevision).toBeUndefined()
    await f.t.run((ctx) =>
      ctx.db.patch("installation", f.installation, {
        policyRevision: POLICY_REVISION,
      })
    )
    expect(
      (await f.outsider.client.query(api.installation.status)).installation
        ?.policyRevision
    ).toBeUndefined()
    expect(await f.revision()).toBe(POLICY_REVISION)
  })
  test("new credentials forget the recorded revision", async () => {
    const f = await fixture()
    const installation = await f.t.run(
      async (ctx) => (await ctx.db.get("installation", f.installation))!
    )
    expect(installation.policyRevision).toBe(POLICY_REVISION)
    await f.owner.client.mutation(internal.installation.activateConnection, {
      revision: installation.credentialRevision,
      accountId: installation.accountId!,
      credentialKind: "keys",
      encryptedCredentials: "rotated",
      accessKeyLast4: "5678",
      defaultRegion: "us-east-1",
      regions: [{ region: "us-east-1", quota: f.region.quota }],
    })
    expect(
      (await f.t.run((ctx) => ctx.db.get("installation", f.installation)))
        ?.policyRevision
    ).toBeUndefined()
  })
})
