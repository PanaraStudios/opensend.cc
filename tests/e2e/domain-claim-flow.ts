import { expect, test, type Page } from "@playwright/test"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import {
  client,
  seedCallbackOrigin,
  seedDomainClaimState,
  seedTeamTenant,
  testBackend,
} from "./ses-fixtures"

const shots = async (page: Page, name: string) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme })
    await page.screenshot({
      path: `${process.env.OPENSEND_TEST_RESULTS}/domain-claim-${name}-${theme}.png`,
      fullPage: true,
    })
  }
  await page.emulateMedia({ colorScheme: "light" })
}

/** Uses a dedicated domain/team and restores the original team for later flows. */
export function domainClaimTests(
  state: () => { owner: Page; organizationId: string }
) {
  test("claims another team's verified domain, shows blocked/expired states, and publishes new DNS records", async () => {
    // Multiple provisioning/cleanup workflows and admin CLI calls can consume
    // the suite's 90s budget on a shared Docker host after the assertions pass.
    test.setTimeout(120_000)
    const { owner, organizationId } = state()
    const backend = await client(owner)
    const name = "claim-wave9.example.test"
    // Domain setup needs the public HTTPS callback; the connection flow left
    // the stack's loopback origin behind.
    await seedCallbackOrigin(owner, "https://callback.opensend.test")
    const original = await backend.mutation(api.domains.create, {
      organizationId,
      name,
      region: "us-east-1",
      customReturnPath: "send",
    })
    const settled = (id: string) =>
      expect
        .poll(
          async () =>
            (await backend.query(api.domains.get, { id }))?.domain.phase,
          { timeout: 30000 }
        )
        .not.toBe("running")
    await settled(original)
    testBackend("domains:finish", {
      id: original,
      changes: {
        status: "verified",
        sesVerified: true,
        dkimVerified: true,
        mailFromVerified: true,
      },
    })
    const claimingTeam = await backend.mutation(api.teams.create, {
      name: "Domain claim fixture",
    })
    await seedTeamTenant(owner, claimingTeam)
    await backend.mutation(api.teams.switchTeam, {
      organizationId: claimingTeam,
    })
    await owner.goto("/domains")
    await owner
      .getByRole("button", { name: "Add domain", exact: true })
      .first()
      .click()
    const dialog = owner.getByRole("dialog", { name: "Add domain" })
    await dialog.getByLabel("Name", { exact: true }).fill(name)
    await dialog
      .getByRole("button", { name: "Add domain", exact: true })
      .click()
    await expect(dialog.getByText("Domain already in use")).toBeVisible()
    await shots(owner, "already-in-use")
    await dialog
      .getByRole("button", { name: "Claim domain", exact: true })
      .click()
    await owner.waitForURL(/\/domains\//)
    let domainId = new URL(owner.url()).pathname
      .split("/")
      .at(-1)! as Id<"domains">
    let claim = (await backend.query(api.domainClaims.get, {
      organizationId: claimingTeam,
      id: domainId,
    }))!
    await expect(
      owner.getByText(claim.record.value, { exact: true })
    ).toBeVisible()
    await expect(
      owner.getByText(
        "is in use by another team. Verifying ownership will transfer the domain to your team and revoke their access."
      )
    ).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "I've added the records" })
    ).toBeEnabled()
    await shots(owner, "pending")
    await owner
      .getByRole("button", { name: "Cancel claim", exact: true })
      .click()
    await expect(
      owner.getByRole("alertdialog", { name: "Cancel domain claim" })
    ).toBeVisible()
    await shots(owner, "cancel-dialog")
    await owner
      .getByRole("alertdialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click()
    // Reserve the in-progress check before clicking so no real DNS request runs.
    // Complete that check through the same private result boundary as the worker.
    const missingCheck = Date.now()
    seedDomainClaimState(claim.id, { checkingAt: missingCheck })
    await owner.getByRole("button", { name: "I've added the records" }).click()
    testBackend("domainClaims:acceptProof", {
      id: claim.id,
      checkingAt: missingCheck,
      matches: false,
      error:
        "TXT record not found. Check the record and try again after DNS updates.",
    })
    await expect
      .poll(
        async () =>
          (
            await backend.query(api.domainClaims.get, {
              organizationId: claimingTeam,
              id: domainId,
            })
          )?.failure_reason,
        { timeout: 30000 }
      )
      .toContain("TXT record not found")
    await shots(owner, "dns-mismatch")
    // Like the SES fixtures, supply the unavailable infrastructure result through
    // the admin-only test CLI. Production TXT checks are covered by convex-test.
    seedDomainClaimState(claim.id, {
      status: "blocked",
      blockedReason: "pending_scheduled_emails",
      failureReason: "The previous team has queued or scheduled emails.",
    })
    await expect(owner.getByText("blocked", { exact: true })).toBeVisible()
    await shots(owner, "blocked")
    seedDomainClaimState(claim.id, {
      status: "expired",
      expiresAt: Date.now() - 1,
      blockedReason: undefined,
      failureReason: undefined,
    })
    await expect(
      owner.getByRole("button", { name: "Start new claim" })
    ).toBeVisible()
    await shots(owner, "expired")
    await owner.getByRole("button", { name: "Start new claim" }).click()
    await expect(owner).not.toHaveURL(new RegExp(domainId))
    domainId = new URL(owner.url()).pathname.split("/").at(-1)! as Id<"domains">
    claim = (await backend.query(api.domainClaims.get, {
      organizationId: claimingTeam,
      id: domainId,
    }))!
    const checkingAt = Date.now()
    seedDomainClaimState(claim.id, { checkingAt })
    testBackend("domainClaims:acceptProof", {
      id: claim.id,
      checkingAt,
      matches: true,
    })
    await settled(original)
    await expect(owner.getByText("verified", { exact: true })).toBeVisible()
    await shots(owner, "transfer-retry")
    testBackend("domains:finish", {
      id: original,
      changes: { deleted: true, tenantAssociated: false, status: "pending" },
    })
    await settled(domainId)
    testBackend("domains:finish", {
      id: domainId,
      changes: {
        records: [
          {
            id: "claim-dkim",
            kind: "DKIM",
            type: "CNAME",
            name: `claim._domainkey.${name}`,
            value: "new-claim.dkim.amazonses.com",
            ttl: "Auto",
            status: "pending",
          },
        ],
      },
    })
    await expect(
      owner.getByText("new-claim.dkim.amazonses.com", { exact: true })
    ).toBeVisible()
    expect(await backend.query(api.domains.get, { id: original })).toBeNull()
    expect(
      await backend.query(api.domainClaims.get, {
        organizationId: claimingTeam,
        id: domainId,
      })
    ).toMatchObject({ status: "completed" })
    await shots(owner, "completed")
    await backend.mutation(api.domains.remove, { id: domainId })
    await settled(domainId)
    testBackend("domains:finish", { id: domainId, changes: { deleted: true } })
    await backend.mutation(api.teams.switchTeam, { organizationId })
    await backend.mutation(api.teams.remove, {
      organizationId: claimingTeam,
      leave: false,
    })
    await seedCallbackOrigin(owner, process.env.OPENSEND_CALLBACK_ORIGIN!)
    await owner.goto("/domains")
  })
}
