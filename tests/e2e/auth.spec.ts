import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { seedSesConnection, seedTeamTenant, testBackend } from "./ses-fixtures"
import { beginOAuth, oauthFlow, selectOAuthTeam } from "./oauth-flow"
import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { execFileSync } from "node:child_process"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
const base = process.env.OPENSEND_BASE_URL ?? "http://localhost:3400"
const ownerEmail = "owner@example.test"
const ownerPassword = "Playwright-owner-password-123"
let memberEmail = "member@example.test"
let memberPassword = "Playwright-member-password-123"
let owner: Page
let member: Page
let ownerContext: BrowserContext
let memberContext: BrowserContext
let sendingDomainId: Id<"domains">
let organizationId: string
let secondTeamId: string
const forms = (page: Page, button: string) =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: button, exact: true }) })
async function emailLink(email: string, subject: string, after = 0) {
  let link = ""
  await expect
    .poll(
      () => {
        const found: string[] = []
        for (const line of readFileSync(
          process.env.OPENSEND_TEST_LOG!,
          "utf8"
        ).split("\n")) {
          try {
            const event = JSON.parse(line) as {
              logLines?: { messages?: string[]; timestamp?: number }[]
            }
            for (const log of event.logLines ?? [])
              for (const text of log.messages ?? []) {
                const message = JSON.parse(text.replace(/^'|'$/g, "")) as {
                  event: string
                  to: string
                  subject: string
                  actionLink: string
                }
                if (
                  message.event === "auth.email" &&
                  message.to === email &&
                  message.subject.toLowerCase().includes(subject) &&
                  (log.timestamp ?? 0) >= after
                )
                  found.push(message.actionLink)
              }
          } catch {
            /* The stream may contain an incomplete line. */
          }
        }
        link = found.at(-1) ?? ""
        return link
      },
      { timeout: 25_000 }
    )
    .not.toBe("")
  return link
}
async function login(
  page: Page,
  email: string,
  password: string,
  next = "/emails"
) {
  await page.goto("/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await page.waitForURL(`**${next}`)
}
async function client(page: Page) {
  let token = ""
  await expect
    .poll(async () => {
      const response = await page.request.get(`${base}/api/auth/convex/token`)
      if (response.ok())
        token = ((await response.json()) as { token: string }).token
      return response.status()
    })
    .toBe(200)
  const result = new ConvexHttpClient(
    process.env.OPENSEND_CONVEX_URL ?? "http://localhost:3410"
  )
  result.setAuth(token)
  return result
}
function totp(secret: string) {
  let bits = ""
  for (const c of secret)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c.toUpperCase())
      .toString(2)
      .padStart(5, "0")
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hash = createHmac("sha1", key).update(counter).digest()
  return ((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0")
}
async function invite(email: string) {
  await owner.goto("/settings/team")
  await owner.getByRole("button", { name: "Invite", exact: true }).click()
  const dialog = owner.getByRole("dialog", { name: "Invite a team member" })
  await dialog.getByLabel("Email address").fill(email)
  await dialog.getByRole("button", { name: "Invite", exact: true }).click()
  await expect(dialog).toBeHidden()
  return emailLink(email, "join")
}
async function createTeam(page: Page, name: string) {
  await page
    .locator('[data-slot="sidebar-header"]')
    .getByRole("button")
    .first()
    .click()
  await page.getByRole("menuitem", { name: "Create team", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create team", exact: true })
  await dialog.getByLabel("Team name").fill(name)
  await dialog.getByRole("button", { name: "Create team", exact: true }).click()
  await expect(dialog).toBeHidden()
  // Team creation queues AWS tenant setup; wait until the worker settles before
  // testing destructive operations. This isolated fixture has no usable AWS key.
  const c = await client(page)
  await expect
    .poll(async () => {
      const account = await c.query(api.teams.snapshot)
      if (!account?.activeTeamId) return false
      const tenants = await c.query(api.tenants.list, {
        organizationId: account.activeTeamId,
      })
      return (
        tenants.length > 0 &&
        tenants.every((tenant) => tenant.phase !== "running")
      )
    })
    .toBe(true)
}
async function logout(page: Page) {
  await page
    .locator('[data-slot="sidebar-footer"]')
    .getByRole("button", { name: /Test (Owner|Member)/ })
    .click()
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click()
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Log out", exact: true })
    .click()
  await expect(page).toHaveURL(/\/login/)
}
async function memberMenu(page: Page, email: string) {
  await page
    .getByRole("row")
    .filter({ hasText: email })
    .getByRole("button", { name: "More options" })
    .click()
}

async function signup(
  page: Page,
  email: string,
  password: string,
  name: string
) {
  await page.getByLabel("Name", { exact: true }).fill(name)
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click()
  await expect(page.getByRole("status")).toContainText("verification link")
}

test.describe.serial("Docker self-hosted authentication", () => {
  test.beforeAll(async ({ browser }) => {
    expect(process.env.OPENSEND_ENV_FILE).toContain(".env.playwright")
    ownerContext = await browser.newContext({ baseURL: base })
    memberContext = await browser.newContext({ baseURL: base })
    owner = await ownerContext.newPage()
    member = await memberContext.newPage()
  })
  test.afterEach(async ({}, info) => {
    if (info.status !== info.expectedStatus) {
      await owner
        .screenshot({ path: info.outputPath("owner.png"), fullPage: true })
        .catch(() => {})
      await member
        .screenshot({ path: info.outputPath("member.png"), fullPage: true })
        .catch(() => {})
    }
  })
  test.afterAll(async () => {
    await ownerContext?.close()
    await memberContext?.close()
  })

  test("protects dashboard/editor routes and verifies the bootstrap account", async () => {
    const anonymous = new ConvexHttpClient(
      process.env.OPENSEND_CONVEX_URL ?? "http://localhost:3410"
    )
    expect(await anonymous.query(api.teams.snapshot)).toBeNull()
    await expect(
      anonymous.mutation(api.teams.create, { name: "Anonymous" })
    ).rejects.toBeTruthy()
    for (const route of ["/emails", "/templates/example"]) {
      await owner.goto(route)
      await expect(owner).toHaveURL(/\/login/)
    }
    await owner.goto("/signup")
    await signup(owner, ownerEmail, ownerPassword, "Test Owner")
    await owner.goto("/login")
    await owner.getByLabel("Email", { exact: true }).fill(ownerEmail)
    await owner.getByLabel("Password", { exact: true }).fill(ownerPassword)
    await owner.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(owner.locator('p[role="alert"]')).toContainText(/verif/i)
    await owner.goto(await emailLink(ownerEmail, "verify"))
    await login(owner, ownerEmail, ownerPassword)
    await expect(
      owner.getByRole("heading", { name: "Set up Opensend", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("link", { name: "Account settings", exact: true })
    ).toHaveCount(0)
    await owner.goto("/profile")
    await expect(owner).toHaveURL(/\/emails$/)
    await expect(
      owner.getByRole("heading", { name: "Set up Opensend", exact: true })
    ).toBeVisible()
    await expect(owner.locator('[data-slot="sidebar-header"]')).toHaveCount(0)
    const pendingClient = await client(owner)
    await expect(
      pendingClient.mutation(api.teams.create, { name: "Bypass setup" })
    ).rejects.toBeTruthy()
    await expect(owner.getByLabel("Public backend URL")).toHaveCount(0)
    await expect(owner.getByLabel("AWS account ID")).toHaveCount(0)
    await owner
      .getByRole("button", { name: "Get started", exact: true })
      .click()
    await expect(
      owner.getByRole("heading", {
        name: "Connect your AWS account",
        exact: true,
      })
    ).toBeVisible()
    await expect(
      owner.getByLabel("Secret access key", { exact: true })
    ).toBeVisible()
    await expect(
      owner.getByText("SES_ENCRYPTION_KEY", { exact: false })
    ).toHaveCount(0)
    await owner.reload()
    await expect(
      owner.getByRole("heading", {
        name: "Connect your AWS account",
        exact: true,
      })
    ).toBeVisible()
    await owner.getByRole("button", { name: "Back", exact: true }).click()
    await expect(
      owner.getByRole("heading", { name: "Set up Opensend", exact: true })
    ).toBeVisible()
    await owner
      .getByRole("button", { name: "Get started", exact: true })
      .click()
    await expect(
      owner.getByRole("heading", {
        name: "Connect your AWS account",
        exact: true,
      })
    ).toBeVisible()
    await owner
      .getByRole("button", { name: "Create AWS user", exact: true })
      .click()
    const awsSetup = owner.getByRole("dialog", {
      name: "Create your AWS user",
      exact: true,
    })
    await expect(
      awsSetup.getByLabel("AWS user name", { exact: true })
    ).toHaveValue("opensend")
    const downloadEvent = owner.waitForEvent("download")
    await awsSetup
      .getByRole("button", { name: "Download setup file", exact: true })
      .click()
    const setupFile = await downloadEvent
    expect(setupFile.suggestedFilename()).toBe("opensend-aws-access.json")
    const templatePath = test.info().outputPath("opensend-aws-access.json")
    await setupFile.saveAs(templatePath)
    const template = JSON.parse(readFileSync(templatePath, "utf8")) as {
      Parameters: { UserName: { Default: string } }
      Resources: Record<string, { Type: string }>
    }
    expect(template.Parameters.UserName.Default).toBe("opensend")
    expect(template.Resources.OpensendUser.Type).toBe("AWS::IAM::User")
    expect(template.Resources.OpensendPolicy.Type).toBe(
      "AWS::IAM::ManagedPolicy"
    )
    expect(JSON.stringify(template)).not.toContain("AWS::IAM::AccessKey")
    await expect(
      awsSetup.getByRole("link", { name: "Open AWS setup", exact: true })
    ).toHaveAttribute(
      "href",
      /https:\/\/us-east-1\.console\.aws\.amazon\.com\/cloudformation\/home\?region=us-east-1/
    )
    await owner.screenshot({
      path: test.info().outputPath("aws-setup-helper.png"),
      fullPage: true,
    })
    await awsSetup
      .getByRole("button", { name: "Back to connection", exact: true })
      .click()
    await expect(awsSetup).toHaveCount(0)
    await owner
      .getByLabel("AWS access key CSV", { exact: true })
      .setInputFiles({
        name: "access-key.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          `Access key ID,Secret access key\nAKIA1234567890123456,${"b".repeat(40)}\n`
        ),
      })
    await expect(
      owner.getByLabel("Access key ID", { exact: true })
    ).toHaveValue("AKIA1234567890123456")
    await expect(
      owner.getByLabel("Secret access key", { exact: true })
    ).toHaveValue("b".repeat(40))
    await owner.getByLabel("Access key ID", { exact: true }).fill("")
    await owner.getByLabel("Secret access key", { exact: true }).fill("")
    await owner.screenshot({
      path: test.info().outputPath("onboarding-desktop.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 390, height: 844 })
    await owner.screenshot({
      path: test.info().outputPath("onboarding-mobile.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 1280, height: 900 })
    await seedSesConnection(owner)
    await expect(
      owner.getByRole("heading", {
        name: "Receive delivery updates",
        exact: true,
      })
    ).toBeVisible()
    await expect(owner.getByLabel("Public backend URL")).toHaveValue("")
    await expect(
      owner.getByText("AWS cannot reach localhost.", { exact: false })
    ).toBeVisible()
    await expect(owner.getByLabel("AWS account ID")).toHaveCount(0)
    await owner.screenshot({
      path: test.info().outputPath("onboarding-delivery-updates.png"),
      fullPage: true,
    })
    // Probe the actual local HTTP service through the authenticated API; a live AWS callback still requires HTTPS.
    const setupClient = await client(owner)
    await setupClient.action(api.installationActions.checkEnvironment, {
      callbackOrigin: process.env.OPENSEND_CALLBACK_ORIGIN!,
    })
    await expect(
      owner.getByRole("heading", {
        name: "Set up your AWS resources",
        exact: true,
      })
    ).toBeVisible()
    await owner.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(
      owner.getByRole("heading", { name: "Create your team", exact: true })
    ).toBeVisible()
    await owner.getByLabel("Team name").fill("Playwright Team")
    await owner
      .getByRole("button", { name: "Create team", exact: true })
      .click()
    await expect(
      owner.getByRole("heading", {
        name: "Add your sending domain",
        exact: true,
      })
    ).toBeVisible()
    await owner.goto("/profile")
    await expect(owner).toHaveURL(/\/emails$/)
    await expect(
      owner.getByRole("heading", {
        name: "Add your sending domain",
        exact: true,
      })
    ).toBeVisible()
    await expect(owner.locator('[data-slot="sidebar-header"]')).toHaveCount(0)
    const pendingTeam = (await pendingClient.query(api.teams.snapshot))!
      .activeTeamId!
    await expect(
      pendingClient.mutation(api.teams.create, { name: "Extra team" })
    ).rejects.toBeTruthy()
    await expect(
      pendingClient.mutation(api.teams.invite, {
        organizationId: pendingTeam,
        email: "blocked@example.test",
        role: "member",
      })
    ).rejects.toBeTruthy()
    await seedTeamTenant(owner, pendingTeam)
    await owner
      .getByRole("button", { name: "Add first domain", exact: true })
      .click()
    const domainDialog = owner.getByRole("dialog", {
      name: "Add domain",
      exact: true,
    })
    await domainDialog
      .getByLabel("Name", { exact: true })
      .fill("onboarding.example.test")
    await domainDialog
      .getByRole("button", { name: "Add domain", exact: true })
      .click()
    await owner.waitForURL(/\/domains\//)
    await expect(owner.locator('[data-slot="sidebar-header"]')).toBeVisible()
    await expect(owner.getByText("Domain setup needs attention")).toBeVisible()
    await expect(
      owner.getByRole("button", { name: "Review existing identity" })
    ).toHaveCount(0)
    await expect(owner.getByRole("button", { name: /^Search/ })).toBeVisible()
    await expect(
      owner.getByRole("link", { name: "Settings", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByRole("link", { name: "Return to setup" })
    ).toHaveCount(0)
    expect(
      (await pendingClient.query(api.installation.status)).installation
        ?.completedAt
    ).toBeTruthy()
    const domainContent = owner.locator('[data-slot="sidebar-inset"]')
    expect((await domainContent.boundingBox())!.width).toBeGreaterThan(700)
    const domainId = new URL(owner.url()).pathname.split("/").at(-1)!
    sendingDomainId = domainId as Id<"domains">
    // Controlled AWS result fixture: this is UI/backend persistence coverage, not live AWS evidence.
    testBackend("domains:finish", {
      id: domainId,
      changes: {
        status: "pending",
        tenantAssociated: true,
        records: [
          {
            id: "fixture-token",
            kind: "DKIM",
            type: "CNAME",
            name: "fixture-token._domainkey.onboarding.example.test",
            value: "fixture.dkim.test",
            ttl: "300",
            status: "pending",
          },
        ],
      },
    })
    await expect(owner.getByText("fixture.dkim.test")).toBeVisible()
    await expect(
      owner.getByRole("heading", { name: "Domain events", exact: true })
    ).toBeVisible()
    await expect(
      owner.getByText("Team SES tenant", { exact: true })
    ).toHaveCount(0)
    await owner
      .getByRole("button", { name: "More options", exact: true })
      .last()
      .click()
    const csvDownload = owner.waitForEvent("download")
    await owner
      .getByRole("menuitem", { name: "Export as CSV", exact: true })
      .click()
    const csv = await csvDownload
    const csvPath = test.info().outputPath("domain-records.csv")
    await csv.saveAs(csvPath)
    expect(readFileSync(csvPath, "utf8")).toContain("fixture.dkim.test")
    await owner
      .getByRole("link", { name: "Domains", exact: true })
      .last()
      .click()
    await expect(
      owner.getByRole("heading", { name: "Domains", exact: true })
    ).toBeVisible()
    await owner
      .getByRole("link", { name: "onboarding.example.test", exact: true })
      .click()
    await expect(owner.getByText("fixture.dkim.test")).toBeVisible()
    await owner.reload()
    await expect(owner.getByText("fixture.dkim.test")).toBeVisible()
    await owner.screenshot({
      path: test.info().outputPath("domain-dns.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 390, height: 844 })
    await expect(owner.getByText("fixture.dkim.test")).toBeVisible()
    await owner.screenshot({
      path: test.info().outputPath("domain-mobile.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 1280, height: 900 })
    await owner.goto("/profile")
    await expect(owner).toHaveURL(/\/profile$/)
    await owner.goto(`/domains/${domainId}`)
    await expect(owner.getByText("fixture.dkim.test")).toBeVisible()
    await owner.emulateMedia({ colorScheme: "dark" })
    await owner.screenshot({
      path: test.info().outputPath("domain-dark.png"),
      fullPage: true,
    })
    await owner.emulateMedia({ colorScheme: "light" })
    const sending = owner.getByRole("switch", {
      name: "Enable Sending",
      exact: true,
    })
    await expect(sending).toBeChecked()
    const mirrorContext = await ownerContext.browser()!.newContext({
      baseURL: base,
      storageState: await ownerContext.storageState(),
    })
    const mirror = await mirrorContext.newPage()
    await mirror.goto(owner.url())
    await expect(
      mirror.getByRole("switch", { name: "Enable Sending", exact: true })
    ).toBeChecked()
    await sending.click()
    await expect(
      mirror.getByRole("switch", { name: "Enable Sending", exact: true })
    ).not.toBeChecked()
    await mirrorContext.close()
    await expect(sending).not.toBeChecked()
    await owner.reload()
    await expect(
      owner.getByRole("switch", { name: "Enable Sending", exact: true })
    ).not.toBeChecked()
    await owner.getByRole("link", { name: "Emails", exact: true }).click()
    await expect(
      owner.getByRole("heading", { name: "Emails", exact: true })
    ).toBeVisible()
    const c = await client(owner)
    expect(
      (await c.query(api.installation.status)).installation?.completedAt
    ).toBeTruthy()
    organizationId = (await c.query(api.teams.snapshot))!.activeTeamId!
    const domainCreatedAt = (await c.query(api.domains.get, {
      id: sendingDomainId,
    }))!.domain._creationTime
    const clockContext = await ownerContext.browser()!.newContext({
      baseURL: base,
      storageState: await ownerContext.storageState(),
    })
    const clockPage = await clockContext.newPage()
    await clockPage.clock.install({ time: new Date(domainCreatedAt + 125_000) })
    await clockPage.goto("/domains")
    const createdTime = clockPage
      .getByRole("row")
      .filter({ hasText: "onboarding.example.test" })
      .locator("time")
    await expect(createdTime).toHaveText("2m ago")
    await clockPage.clock.fastForward(60_000)
    await expect(createdTime).toHaveText("3m ago")
    await clockContext.close()
    await owner.goto("/settings/ses")
    await expect(owner.getByTestId("ses-settings")).toBeVisible()
    await expect(owner.getByTestId("installation-wizard")).toHaveCount(0)
    await expect(owner.getByText(/Step \d+ of \d+/)).toHaveCount(0)
    await expect(
      owner.getByRole("button", { name: "Create AWS user", exact: true })
    ).toHaveCount(0)
    await expect(
      owner.getByRole("button", { name: "Keep current connection" })
    ).toHaveCount(0)
    const permissionFile = owner.waitForEvent("download")
    await owner
      .getByRole("button", { name: "Download permissions", exact: true })
      .click()
    const permissions = await permissionFile
    const permissionsPath = test.info().outputPath("settings-permissions.json")
    await permissions.saveAs(permissionsPath)
    expect(readFileSync(permissionsPath, "utf8")).toContain("ses:GetTenant")
    expect(readFileSync(permissionsPath, "utf8")).not.toContain("Fn::Sub")
    await owner
      .getByRole("button", { name: "Update connection", exact: true })
      .click()
    const connectionDialog = owner.getByRole("dialog", {
      name: "Update AWS connection",
      exact: true,
    })
    await expect(
      connectionDialog.getByLabel("AWS account ID")
    ).toHaveJSProperty("readOnly", true)
    await expect(
      connectionDialog.getByLabel("Secret access key", { exact: true })
    ).toHaveValue("")
    const revision = (await c.query(api.installation.status)).installation!
      .credentialRevision
    await connectionDialog
      .getByLabel("Access key ID", { exact: true })
      .fill("invalid")
    await connectionDialog
      .getByLabel("Secret access key", { exact: true })
      .fill("invalid-test-only")
    await connectionDialog
      .getByRole("button", { name: "Save connection", exact: true })
      .click()
    await expect(connectionDialog.getByRole("alert")).toContainText(
      "Enter valid AWS credentials"
    )
    expect(
      (await c.query(api.installation.status)).installation!.credentialRevision
    ).toBe(revision)
    await owner.keyboard.press("Escape")
    await expect(connectionDialog).toHaveCount(0)
    await expect(
      owner.getByRole("button", { name: "Update connection", exact: true })
    ).toBeFocused()
    await owner
      .getByRole("button", { name: "Check connection", exact: true })
      .click()
    await expect(
      owner.getByRole("status").filter({ hasText: "Connection checked" })
    ).toBeVisible()
    await owner.evaluate(() => window.scrollTo(0, 0))
    await owner.screenshot({
      path: test.info().outputPath("ses-settings-desktop.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 390, height: 844 })
    await owner.screenshot({
      path: test.info().outputPath("ses-settings-mobile.png"),
      fullPage: true,
    })
    await owner.setViewportSize({ width: 1280, height: 900 })
    await owner.goto("/emails")
    await member.goto("/signup")
    await member.getByLabel("Name", { exact: true }).fill("Uninvited")
    await member
      .getByLabel("Email", { exact: true })
      .fill("uninvited@example.test")
    await member.getByLabel("Password", { exact: true }).fill(memberPassword)
    await member
      .getByRole("button", { name: "Create account", exact: true })
      .click()
    await expect(member.locator('p[role="alert"]')).toBeVisible()
  })

  test("authorizes hosted and local OAuth clients, exchanges tokens and rejects refresh replay", async () => {
    await oauthFlow(owner, organizationId)
  })

  test("renders every existing dashboard section with a real session", async () => {
    const errors: string[] = []
    const record = (error: Error) => errors.push(error.message)
    owner.on("pageerror", record)
    for (const route of [
      "/emails",
      "/emails/receiving",
      "/emails/suppressions",
      "/broadcasts",
      "/automations",
      "/automations/events",
      "/templates",
      "/contacts",
      "/segments",
      "/topics",
      "/properties",
      "/metrics",
      "/domains",
      "/logs",
      "/api-keys",
      "/webhooks",
      "/settings/team",
      "/settings/sso",
      "/settings/unsubscribe",
      "/settings/ses",
      "/settings/smtp",
      "/settings/exports",
      "/profile",
    ]) {
      await owner.goto(route)
      await expect(owner.locator("main")).toBeVisible()
      await expect(
        owner.getByRole("heading", { name: "Something went wrong." })
      ).toHaveCount(0)
    }
    for (const route of [
      "/templates/tpl_welcome",
      "/broadcasts/brd_beta/edit",
      "/automations/atm_onboard",
    ]) {
      await owner.goto(route)
      await expect(owner.getByTestId("editor-topbar")).toBeVisible()
    }
    await owner.goto("/templates/tpl_welcome")
    await owner.getByTestId("editor-name").fill("Scoped demo template")
    await owner.getByTestId("editor-name").press("Tab")
    await owner.goto("/contacts")
    const groupedInput = owner
      .locator(
        '[data-slot="input-group"] > input[data-slot="input-group-control"]'
      )
      .first()
    await expect(groupedInput).toBeVisible()
    await groupedInput.fill("no-matching-contact@example.invalid")
    await expect(owner.getByRole("cell")).toHaveCount(0)
    await groupedInput.fill("")
    await expect.poll(() => owner.getByRole("cell").count()).toBeGreaterThan(0)
    await owner.goto("/topics")
    await owner
      .getByRole("button", { name: "Create topic", exact: true })
      .click()
    const dialog = owner.getByRole("dialog")
    const description = dialog.getByLabel("Description", { exact: true })
    await description.evaluate((node) => {
      const input = node as HTMLTextAreaElement
      input.required = true
      input.reportValidity()
    })
    await expect(owner.locator('[data-slot="inline-toast"]')).toContainText(
      "Fill out this field"
    )
    await description.fill("Example description")
    await expect(owner.locator('[data-slot="inline-toast"]')).toHaveCount(0)
    await expect(description).toHaveValue("Example description")
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
    owner.off("pageerror", record)
    expect(errors).toEqual([])
  })

  test("renames teams, validates avatars, switches teams, and keeps slugs unique", async () => {
    await owner.goto("/settings/team")
    const overview = forms(owner, "Save")
    await overview.getByLabel("Team name", { exact: true }).fill("Renamed Team")
    await overview.getByLabel("Slug", { exact: true }).fill("renamed-team")
    await overview.getByRole("button", { name: "Save", exact: true }).click()
    await expect(owner.getByText("Team saved", { exact: true })).toBeVisible()
    const upload = owner.getByLabel("Team avatar", { exact: true })
    await upload.setInputFiles({
      name: "large.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(1048577),
    })
    await expect(
      owner.getByText("Maximum file size is 1MB", { exact: true })
    ).toBeVisible()
    await upload.setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: await owner.screenshot({
        clip: { x: 0, y: 0, width: 32, height: 32 },
      }),
    })
    await expect(
      owner.getByRole("button", { name: "Remove", exact: true })
    ).toBeVisible()
    await owner.getByRole("button", { name: "Remove", exact: true }).click()
    await expect(
      owner.getByRole("button", { name: "Remove", exact: true })
    ).toHaveCount(0)
    await owner.goto("/profile")
    await createTeam(owner, "Second Team")
    const c = await client(owner)
    await expect
      .poll(async () => (await c.query(api.teams.snapshot))!.teams.length)
      .toBe(2)
    secondTeamId = (await c.query(api.teams.snapshot))!.activeTeamId!
    await owner.goto("/templates/tpl_welcome")
    await expect(owner.getByTestId("editor-name")).not.toHaveValue(
      "Scoped demo template"
    )
    await owner.goto("/settings/team")
    await forms(owner, "Save").getByLabel("Slug").fill("renamed-team")
    await forms(owner, "Save")
      .getByRole("button", { name: "Save", exact: true })
      .click()
    await expect(
      owner.getByText("That slug is already in use", { exact: true })
    ).toBeVisible()
    await owner.getByRole("button", { name: /Second Team second-team/ }).click()
    await owner
      .getByRole("menuitem", { name: /Renamed Team renamed-team/ })
      .click()
    await expect
      .poll(async () => (await c.query(api.teams.snapshot))!.activeTeamId)
      .toBe(organizationId)
  })

  test("resends, cancels, rejects and accepts matching-email invitations", async () => {
    const cancelled = "cancelled@example.test"
    await invite(cancelled)
    const row = owner.getByRole("row").filter({ hasText: cancelled })
    const since = Date.now()
    await row.getByRole("button", { name: "More options" }).click()
    await owner.getByRole("menuitem", { name: "Resend invitation" }).click()
    await emailLink(cancelled, "join", since)
    await row.getByRole("button", { name: "More options" }).click()
    await owner.getByRole("menuitem", { name: "Cancel invitation" }).click()
    await expect(row).toHaveCount(0)
    const link = await invite(memberEmail)
    await member.goto(link)
    await member.getByRole("link", { name: "Create account" }).click()
    await signup(member, memberEmail, memberPassword, "Test Member")
    await member.goto(await emailLink(memberEmail, "verify"))
    await member.getByLabel("Email", { exact: true }).fill(memberEmail)
    await member.getByLabel("Password", { exact: true }).fill(memberPassword)
    await member.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(
      member.getByRole("heading", { name: "Join Renamed Team" })
    ).toBeVisible()
    const viewport = member.viewportSize()
    for (const colorScheme of ["light", "dark"] as const) {
      await member.emulateMedia({ colorScheme })
      for (const width of [1440, 390]) {
        await member.setViewportSize({ width, height: 1000 })
        await expect(
          member.getByText(memberEmail, { exact: true })
        ).toBeVisible()
        await expect(
          member.getByRole("button", { name: "Accept invitation" })
        ).toBeVisible()
        await expect(
          member.getByRole("button", { name: "Reject invitation" })
        ).toBeVisible()
        expect(
          await member.evaluate(() => document.documentElement.scrollWidth)
        ).toBe(width)
        await member.screenshot({
          path: test
            .info()
            .outputPath(`invitation-${colorScheme}-${width}.png`),
          fullPage: true,
        })
      }
    }
    await member.emulateMedia({ colorScheme: "light" })
    if (viewport) await member.setViewportSize(viewport)
    execFileSync(
      "pnpm",
      [
        "backend",
        "run",
        "--component",
        "betterAuth",
        "adapter:updateOne",
        JSON.stringify({
          input: {
            model: "invitation",
            where: [
              { field: "_id", value: new URL(link).searchParams.get("id") },
            ],
            update: { expiresAt: Date.now() - 1000 },
          },
        }),
      ],
      { env: process.env, stdio: "pipe" }
    )
    await member.reload()
    await expect(
      member.getByRole("heading", { name: "Invitation unavailable" })
    ).toBeVisible()
    await member.goto(await invite(memberEmail))
    await member.getByRole("button", { name: "Reject invitation" }).click()
    await expect(member).toHaveURL(/\/profile/)
    const retry = await invite(memberEmail)
    await owner.goto(retry)
    await expect(
      owner.getByRole("heading", { name: "Invitation unavailable" })
    ).toBeVisible()
    await member.goto(retry)
    await member.getByRole("button", { name: "Accept invitation" }).click()
    await expect(member).toHaveURL(/\/emails/)
    await member.goto(retry)
    await expect(
      member.getByRole("heading", { name: "Invitation unavailable" })
    ).toBeVisible()
  })

  test("enforces cross-team permissions and last-admin rules in UI and direct requests", async () => {
    const c = await client(member)
    await expect(
      c.mutation(api.installation.provisionRegion, { region: "us-east-1" })
    ).rejects.toBeTruthy()
    await expect(
      c.mutation(api.domains.update, { id: sendingDomainId, sending: true })
    ).rejects.toBeTruthy()
    await member.goto(`/domains/${sendingDomainId}`)
    await expect(
      member.getByRole("button", {
        name: /^(Verify DNS records|Restart verification)$/,
      })
    ).toBeDisabled()
    await expect(
      c.mutation(api.teams.rename, {
        organizationId: secondTeamId,
        name: "Stolen",
      })
    ).rejects.toBeTruthy()
    await member.goto("/settings/team")
    await expect(
      forms(member, "Save").getByRole("button", { name: "Save", exact: true })
    ).toBeDisabled()
    await expect(
      member.getByRole("button", { name: "Make admin" })
    ).toHaveCount(0)
    await owner.goto("/settings/team")
    await memberMenu(owner, ownerEmail)
    await owner
      .getByRole("menuitem", { name: "Leave team", exact: true })
      .click()
    const leaveDialog = owner.getByRole("alertdialog")
    await leaveDialog
      .getByRole("button", { name: "Leave team", exact: true })
      .click()
    await expect(leaveDialog.getByRole("alert")).toContainText("another admin")
    await leaveDialog
      .getByRole("button", { name: "Cancel", exact: true })
      .click()
    const admin = await client(owner)
    await expect(
      admin.mutation(api.teams.deleteAccount, {})
    ).rejects.toBeTruthy()
    const forbidden = await member.request.post(
      `${base}/api/auth/organization/update`,
      {
        headers: { Origin: base },
        data: { organizationId, data: { name: "Bypass" } },
      }
    )
    expect(forbidden.status()).toBe(403)
    await memberMenu(owner, memberEmail)
    await owner.getByRole("menuitem", { name: "Change role to Admin" }).click()
    await expect(
      owner
        .getByRole("row")
        .filter({ hasText: memberEmail })
        .getByText("Admin", { exact: true })
    ).toBeVisible()
    await memberMenu(owner, memberEmail)
    await owner.getByRole("menuitem", { name: "Change role to Member" }).click()
    await expect(
      owner
        .getByRole("row")
        .filter({ hasText: memberEmail })
        .getByText("Member", { exact: true })
    ).toBeVisible()
  })

  test("enrolls MFA, checks OTP and backup codes, regenerates and disables securely", async () => {
    await member.goto("/profile")
    await member
      .getByRole("button", { name: "Enable MFA", exact: true })
      .click()
    const enroll = member.getByRole("dialog", {
      name: "Setup multi-factor authentication",
    })
    await enroll.getByLabel("Password", { exact: true }).fill(memberPassword)
    const enrollmentResponse = member.waitForResponse(
      (r) =>
        r.url().endsWith("/two-factor/enable") &&
        r.request().method() === "POST"
    )
    await enroll.getByRole("button", { name: "Continue", exact: true }).click()
    const enrollment = (await (await enrollmentResponse).json()) as {
      totpURI: string
      backupCodes: string[]
    }
    await expect(
      member.locator("pre").filter({ hasText: enrollment.backupCodes[0] })
    ).toBeVisible()
    const secret = new URL(enrollment.totpURI).searchParams.get("secret")!
    await member
      .getByLabel("Verify the code from the app", { exact: true })
      .fill(totp(secret))
    const verified = member.waitForResponse(
      (r) =>
        r.url().endsWith("/two-factor/verify-totp") &&
        r.request().method() === "POST"
    )
    await enroll.getByRole("button", { name: "Add", exact: true }).click()
    expect((await verified).status()).toBe(200)
    await expect(
      member.getByRole("button", { name: "Regenerate backup codes" })
    ).toBeVisible()
    expect(
      await member.evaluate(() => JSON.stringify(localStorage))
    ).not.toContain(secret)
    const oldClient = await client(member)
    await logout(member)
    await expect(member).toHaveURL(/\/login/)
    expect(await oldClient.query(api.teams.snapshot)).toBeNull()
    await beginOAuth(member)
    await member.getByRole("link", { name: "Sign in", exact: true }).click()
    await member.getByLabel("Email", { exact: true }).fill(memberEmail)
    await member.getByLabel("Password", { exact: true }).fill(memberPassword)
    await member.getByRole("button", { name: "Sign in", exact: true }).click()
    await expect(member).toHaveURL(/\/mfa\?next=/)
    expect(
      (await member.request.get(`${base}/api/auth/convex/token`)).ok()
    ).toBeFalsy()
    await member.getByLabel("Authenticator code").fill("000000")
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member.locator('p[role="alert"]')).toBeVisible()
    await member.getByRole("button", { name: "Use a backup code" }).click()
    await member.getByLabel("Backup code").fill(enrollment.backupCodes[0])
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member).toHaveURL(/\/oauth\/consent\?flow=/)
    await expect(
      member.getByRole("heading", { name: "Connect Continuation example" })
    ).toBeVisible()
    await member.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(
      member.getByRole("heading", { name: "Authorization cancelled" })
    ).toBeVisible()
    await member.goto("/profile")
    await member
      .getByRole("button", { name: "Regenerate backup codes" })
      .click()
    const regenerate = member.getByRole("dialog", {
      name: "Backup codes",
      exact: true,
    })
    await regenerate
      .getByLabel("Password", { exact: true })
      .fill(memberPassword)
    const regenResponse = member.waitForResponse((r) =>
      r.url().endsWith("/two-factor/generate-backup-codes")
    )
    await regenerate
      .getByRole("button", { name: "Regenerate backup codes" })
      .click()
    const regenerated = (await (await regenResponse).json()) as {
      backupCodes: string[]
    }
    expect(regenerated.backupCodes).not.toEqual(enrollment.backupCodes)
    await regenerate.getByRole("button", { name: "Done", exact: true }).click()
    await logout(member)
    await login(member, memberEmail, memberPassword, "/mfa")
    await member.getByRole("button", { name: "Use a backup code" }).click()
    await member.getByLabel("Backup code").fill(enrollment.backupCodes[1])
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member.locator('p[role="alert"]')).toBeVisible()
    await member.getByLabel("Backup code").fill(regenerated.backupCodes[0])
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member).toHaveURL(/\/emails/)
    await member.goto("/profile")
    await member
      .getByRole("button", { name: "Disable MFA", exact: true })
      .click()
    const disable = member.getByRole("dialog", {
      name: "Disable MFA?",
      exact: true,
    })
    await disable.getByLabel("Password", { exact: true }).fill("wrong-password")
    await disable
      .getByRole("button", { name: "Disable MFA", exact: true })
      .click()
    await expect(disable.getByRole("alert")).toBeVisible()
    await disable.getByLabel("Password", { exact: true }).fill(memberPassword)
    const disabled = member.waitForResponse(
      (r) => r.url().endsWith("/two-factor/disable") && r.status() === 200
    )
    await disable
      .getByRole("button", { name: "Disable MFA", exact: true })
      .click()
    expect((await disabled).status()).toBe(200)
    await member.goto("/profile")
    await expect(
      member.getByRole("button", { name: "Enable MFA", exact: true })
    ).toBeVisible()
  })

  test("changes passwords, resets them, revokes old sessions, and verifies email changes", async () => {
    const authentication = member.locator('[data-slot="card"]').filter({
      has: member.getByRole("heading", {
        name: "Authentication",
        exact: true,
      }),
    })
    await authentication.getByRole("button", { name: "More options" }).click()
    await member
      .getByRole("menuitem", { name: "Change password", exact: true })
      .click()
    const change = member.getByRole("dialog", {
      name: "Change password",
      exact: true,
    })
    await change.getByLabel("Current password").fill(memberPassword)
    memberPassword += "-changed"
    await change.getByLabel("New password").fill(memberPassword)
    await change.getByRole("button", { name: "Change password" }).click()
    await expect(change).toBeHidden()
    const old = await client(member)
    await member.goto("/forgot-password")
    await member.getByLabel("Email", { exact: true }).fill(memberEmail)
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member.getByRole("status")).toBeVisible()
    await member.goto(await emailLink(memberEmail, "reset"))
    memberPassword += "-reset"
    await member.getByLabel("Password", { exact: true }).fill(memberPassword)
    await member.getByRole("button", { name: "Continue", exact: true }).click()
    await expect(member.getByRole("status")).toContainText("Password reset")
    expect(await old.query(api.teams.snapshot)).toBeNull()
    await login(member, memberEmail, memberPassword)
    await member.goto("/profile")
    const email = forms(member, "Update email")
    const nextEmail = "changed-member@example.test"
    await email.getByLabel("Email address").fill(nextEmail)
    await email.getByRole("button", { name: "Update email" }).click()
    await expect(
      member.getByText("Check your email to confirm the change", {
        exact: true,
      })
    ).toBeVisible()
    await member.goto(await emailLink(memberEmail, "confirm"))
    await member.goto(await emailLink(nextEmail, "verify"))
    memberEmail = nextEmail
    await expect(member.getByLabel("Email address")).toHaveValue(memberEmail)
  })

  test("requires an OIDC test before enforcement and rejects invalid callbacks", async ({
    browser,
  }) => {
    await owner.goto("/settings/sso")
    const save = forms(owner, "Save connection")
    await save.getByLabel("Issuer URL").fill("not-a-url")
    await save.getByRole("button", { name: "Save connection" }).click()
    await expect(owner.locator('[data-slot="inline-toast"]')).toContainText(
      "Enter a valid URL"
    )

    await save.getByLabel("Issuer URL").fill(process.env.OPENSEND_OIDC_URL!)
    await save.getByLabel("Client ID").fill("opensend-test")
    await save.getByLabel("Client secret").fill("isolated-test-secret")
    await save.getByRole("button", { name: "Save connection" }).click()
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeDisabled()
    const intruderContext = await browser.newContext({ baseURL: base })
    const intruder = await intruderContext.newPage()
    await intruder.goto("/sso")
    await intruder.getByLabel("Team ID").fill(organizationId)
    await intruder
      .getByRole("button", { name: "Continue", exact: true })
      .click()
    await intruder.getByLabel("Username or email").fill("oidc-owner")
    await intruder
      .getByLabel("Password", { exact: true })
      .fill("isolated-oidc-password")
    await intruder.getByRole("button", { name: "Sign In", exact: true }).click()
    await expect(intruder).toHaveURL(/\/login\?error=/)
    expect(
      await (await intruder.request.get(`${base}/api/auth/get-session`)).json()
    ).toBeNull()
    await intruderContext.close()
    await owner.getByRole("button", { name: "Test connection" }).click()
    await owner.getByLabel("Username or email").fill("oidc-owner")
    await owner
      .getByLabel("Password", { exact: true })
      .fill("isolated-oidc-password")
    await owner.getByRole("button", { name: "Sign In", exact: true }).click()
    await expect(owner).toHaveURL(/\/settings\/sso/)
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeEnabled()
    await owner.getByRole("switch", { name: /Enable SSO/ }).click()
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeChecked()
    const passwordContext = await browser.newContext({ baseURL: base })
    const passwordOwner = await passwordContext.newPage()
    await login(passwordOwner, ownerEmail, ownerPassword)
    await expect(
      passwordOwner.getByRole("button", { name: "Continue with SSO" })
    ).toBeVisible()
    const passwordClient = await client(passwordOwner)
    await expect(
      passwordClient.mutation(api.teams.rename, {
        organizationId,
        name: "SSO bypass",
      })
    ).rejects.toMatchObject({ data: "SSO_REQUIRED" })
    const direct = await passwordOwner.request.post(
      `${base}/api/auth/organization/update`,
      {
        headers: { Origin: base },
        data: { organizationId, data: { name: "SSO bypass" } },
      }
    )
    expect(direct.status()).toBe(403)
    await beginOAuth(passwordOwner)
    await selectOAuthTeam(passwordOwner, organizationId)
    await passwordOwner
      .getByRole("button", { name: "Continue with SSO", exact: true })
      .click()
    await passwordOwner.getByLabel("Username or email").fill("oidc-owner")
    await passwordOwner
      .getByLabel("Password", { exact: true })
      .fill("isolated-oidc-password")
    await passwordOwner
      .getByRole("button", { name: "Sign In", exact: true })
      .click()
    await expect(passwordOwner).toHaveURL(/\/oauth\/consent\?flow=/)
    await selectOAuthTeam(passwordOwner, organizationId)
    await expect(
      passwordOwner.getByRole("button", { name: "Authorize", exact: true })
    ).toBeEnabled()
    await passwordOwner
      .getByRole("button", { name: "Cancel", exact: true })
      .click()
    await expect(
      passwordOwner.getByRole("heading", { name: "Authorization cancelled" })
    ).toBeVisible()
    await passwordContext.close()
    const c = await client(member)
    const snapshot = (await c.query(api.teams.snapshot))!
    expect(snapshot.teams[0].ssoRequired).toBe(true)
    expect(snapshot.members).toEqual([])
    expect(JSON.stringify(snapshot)).not.toContain("isolated-test-secret")
    await expect(
      c.mutation(api.teams.rename, { organizationId, name: "Bypassed" })
    ).rejects.toBeTruthy()
    await member.goto("/settings/team")
    await expect(
      member.getByRole("button", { name: "Continue with SSO" })
    ).toBeVisible()
    await member.goto("/profile")
    await expect(
      member.getByRole("heading", { name: "Profile", exact: true })
    ).toBeVisible()
    const invalid = await memberContext.newPage()
    await invalid.goto(
      `/api/auth/oauth2/callback/${organizationId}?code=invalid&state=invalid`
    )
    await expect(invalid).toHaveURL(/\/login\?error=/)
    await invalid.close()
  })

  test("rejects an uninvited OIDC identity and preserves enforcement after restart", async ({
    browser,
  }) => {
    const strangerContext = await browser.newContext({ baseURL: base })
    const stranger = await strangerContext.newPage()
    await stranger.goto("/sso")
    await stranger.getByLabel("Team ID").fill(organizationId)
    await stranger
      .getByRole("button", { name: "Continue", exact: true })
      .click()
    await stranger.getByLabel("Username or email").fill("uninvited")
    await stranger
      .getByLabel("Password", { exact: true })
      .fill("isolated-oidc-password")
    await stranger.getByRole("button", { name: "Sign In", exact: true }).click()
    await expect(stranger).toHaveURL(/\/login\?error=/)
    await stranger.goto("/emails")
    await expect(stranger).toHaveURL(/\/login/)
    await strangerContext.close()
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        process.env.OPENSEND_ENV_FILE!,
        "-p",
        process.env.COMPOSE_PROJECT_NAME!,
        "restart",
        "convex",
        "app",
      ],
      { stdio: "pipe" }
    )
    execFileSync(
      "docker",
      [
        "compose",
        "--env-file",
        process.env.OPENSEND_ENV_FILE!,
        "-p",
        process.env.COMPOSE_PROJECT_NAME!,
        "up",
        "-d",
        "--wait",
        "convex",
        "app",
      ],
      { stdio: "pipe" }
    )
    await owner.goto("/settings/sso")
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeChecked()
    await member.goto("/settings/team")
    await expect(
      member.getByRole("button", { name: "Continue with SSO" })
    ).toBeVisible()
  })

  test("invalidates changed providers and supports operator recovery", async () => {
    await owner.goto("/settings/sso")
    const save = forms(owner, "Save connection")
    await save.getByLabel("Client secret").fill("isolated-test-secret")
    await save.getByRole("button", { name: "Save connection" }).click()
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeDisabled()
    await owner.goto("/profile")
    const connected = owner.waitForEvent("framenavigated", {
      predicate: (frame) =>
        frame === owner.mainFrame() &&
        new URL(frame.url()).pathname === "/profile",
    })
    await owner
      .getByRole("button", { name: "Continue with SSO", exact: true })
      .click()
    await connected
    await owner.waitForLoadState("domcontentloaded")
    await owner.goto("/settings/sso")
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeEnabled()
    await owner.getByRole("switch", { name: /Enable SSO/ }).click()
    await expect(
      owner.getByRole("switch", { name: /Enable SSO/ })
    ).toBeChecked()
    execFileSync(
      "pnpm",
      ["backend", "run", "sso:recover", JSON.stringify({ organizationId })],
      { env: process.env, stdio: "pipe" }
    )
    await member.goto("/settings/team")
    await expect(
      member.getByRole("heading", { name: "Overview", exact: true })
    ).toBeVisible()
  })

  test("removes membership immediately, supports create/join state and account deletion", async () => {
    await owner.goto("/settings/team")
    await memberMenu(owner, memberEmail)
    await owner
      .getByRole("menuitem", { name: "Remove from team", exact: true })
      .click()
    await owner
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove", exact: true })
      .click()
    await member.goto("/emails")
    await expect(
      member.getByRole("heading", { name: "Create or join a team" })
    ).toBeVisible()
    await member.getByRole("link", { name: "Account settings" }).click()
    await expect(
      member.getByRole("heading", { name: "Profile", exact: true })
    ).toBeVisible()
    await createTeam(member, "Disposable Team")
    const teamsCard = member.locator('[data-slot="card"]').filter({
      has: member.getByRole("heading", { name: "Teams", exact: true }),
    })
    const disposable = teamsCard
      .locator('[data-slot="item"]')
      .filter({ hasText: "Disposable Team" })
    await disposable.getByRole("button", { name: "More options" }).click()
    await member.getByRole("menuitem", { name: "Leave", exact: true }).click()
    const deleteTeamDialog = member.getByRole("alertdialog", {
      name: "Delete team",
      exact: true,
    })
    await deleteTeamDialog.getByRole("textbox").fill("DELETE")
    await deleteTeamDialog
      .getByRole("button", { name: "Delete team", exact: true })
      .click()
    await expect(disposable).toHaveCount(0)
    // A fresh password login proves recent authentication before deletion.
    await logout(member)
    await login(member, memberEmail, memberPassword)
    await expect(
      member.getByRole("heading", {
        name: "Create or join a team",
        exact: true,
      })
    ).toBeVisible()
    await member.goto("/profile")
    const stale = await client(member)
    await member
      .getByRole("button", { name: "Delete account", exact: true })
      .click()
    const deletion = member.getByRole("alertdialog", {
      name: "Delete account",
      exact: true,
    })
    await deletion.getByRole("textbox").fill("DELETE")
    await deletion
      .getByRole("button", { name: "Delete account", exact: true })
      .click()
    await expect(member).toHaveURL(/\/login/)
    expect(await stale.query(api.teams.snapshot)).toBeNull()
  })
})
