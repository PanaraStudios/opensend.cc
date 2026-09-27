import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { SESv2Client } from "@aws-sdk/client-sesv2"
import { SESClient } from "@aws-sdk/client-ses"
import { api, internal } from "./_generated/api"
import { POLICY_REVISION, resourcePrefix } from "./ses/contracts"
import { fixture, storeTestCredentials } from "./testHelpers/ses.fixture"

beforeEach(() => vi.stubEnv("SES_ENCRYPTION_KEY", "ab".repeat(32)))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const awsFailure = (name: string) =>
  Object.assign(new Error("provider detail that must stay private"), { name })

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
/** The AWS boundary: each probe answers with the given error, or succeeds. */
function answer(probes: { send?: string; receipt?: string }) {
  const sent: Record<string, unknown>[] = []
  vi.spyOn(SESv2Client.prototype, "send").mockImplementation(
    async (command) => {
      sent.push(command.input as Record<string, unknown>)
      if (probes.send) throw awsFailure(probes.send)
      return {} as never
    }
  )
  vi.spyOn(SESClient.prototype, "send").mockImplementation(async () => {
    if (probes.receipt) throw awsFailure(probes.receipt)
    return {} as never
  })
  return sent
}

describe("AWS policy revision", () => {
  test("send context refuses until the current permissions are recorded", async () => {
    const f = await fixture()
    await f.t.run(async (ctx) => {
      await ctx.db.patch("domains", f.domain, {
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
  test("only the super admin can check permissions or see the revision", async () => {
    const f = await behindFixture()
    const sent = answer({ send: "MessageRejected" })
    // The outsider owns a team but is not the installation's first user.
    await expect(
      f.outsider.client.action(api.installationActions.checkPermissions, {})
    ).rejects.toThrow("installation administrator")
    expect(sent).toEqual([])
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
  test("a rejection after authorization proves the permission and records the revision", async () => {
    const f = await behindFixture()
    const sent = answer({ send: "MessageRejected" })
    await f.owner.client.action(api.installationActions.checkPermissions, {})
    expect(await f.revision()).toBe(POLICY_REVISION)
    // The probe names one of this installation's tenants and an address that
    // can never be verified, so SES cannot deliver it.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      FromEmailAddress: "probe@permission-check.invalid",
      TenantName: `${resourcePrefix(f.installation)}-t-permissioncheck`,
      Destination: { ToAddresses: ["success@simulator.amazonses.com"] },
    })
    expect(sent[0].ConfigurationSetName).toBeUndefined()
  })
  test("an access denial on either probe records nothing and keeps AWS details private", async () => {
    for (const probes of [
      { send: "AccessDeniedException" },
      { send: "MessageRejected", receipt: "AccessDenied" },
    ]) {
      const f = await behindFixture()
      answer(probes)
      const error = await f.owner.client
        .action(api.installationActions.checkPermissions, {})
        .catch((e: unknown) => e)
      expect(String(error)).toContain("has not granted the new permissions")
      expect(String(error)).not.toContain("provider detail")
      expect(await f.revision()).toBeUndefined()
    }
  })
  test("errors that prove nothing surface safely and do not record a revision", async () => {
    const f = await behindFixture()
    answer({ send: "ThrottlingException" })
    const error = await f.owner.client
      .action(api.installationActions.checkPermissions, {})
      .catch((e: unknown) => e)
    expect(String(error)).toContain("throttled")
    expect(String(error)).not.toContain("provider detail")
    expect(await f.revision()).toBeUndefined()
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
  test("checks are rate limited", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const f = await behindFixture()
    answer({ send: "AccessDeniedException" })
    const check = () =>
      f.owner.client.action(api.installationActions.checkPermissions, {})
    await expect(check()).rejects.toThrow("has not granted")
    await expect(check()).rejects.toThrow("Checked just now")
    vi.setSystemTime(Date.now() + 10_000)
    answer({ send: "MessageRejected" })
    await check()
    expect(await f.revision()).toBe(POLICY_REVISION)
  })
})
