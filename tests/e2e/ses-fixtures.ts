import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../../convex/_generated/api"

function assertTestOwnership() {
  const path = process.env.OPENSEND_ENV_FILE ?? ""
  const project = process.env.COMPOSE_PROJECT_NAME ?? ""
  if (
    !project.startsWith("opensend-e2e-") ||
    !path.includes(".env.playwright-") ||
    !readFileSync(path, "utf8").includes(`INSTANCE_NAME=${project}\n`)
  )
    throw new Error("Refusing to seed an instance not owned by this test run")
}
/** Test-only admin commands, never shipped as public application endpoints. */
export function testBackend(name: string, args: unknown, component?: string) {
  assertTestOwnership()
  execFileSync(
    "node",
    [
      "scripts/backend.mjs",
      "run",
      ...(component ? ["--component", component] : []),
      name,
      JSON.stringify(args),
    ],
    { stdio: "pipe", env: process.env }
  )
}
function importFixture(
  table: string,
  row: Record<string, unknown>,
  replace = false
) {
  assertTestOwnership()
  const file = join(
    process.env.OPENSEND_TEST_RESULTS!,
    `${table}-fixture.jsonl`
  )
  writeFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 })
  execFileSync(
    "node",
    [
      "scripts/backend.mjs",
      "import",
      "--table",
      table,
      replace ? "--replace" : "--append",
      "--yes",
      file,
    ],
    { stdio: "pipe", env: process.env }
  )
}
/** A Convex client signed in as the page's user. */
export async function client(page: Page) {
  const base = process.env.OPENSEND_BASE_URL ?? "http://localhost:3400"
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
export async function seedSesConnection(page: Page) {
  const status = await (await client(page)).query(api.installation.status)
  // Synthetic ciphertext deliberately cannot authenticate an AWS request.
  importFixture(
    "installation",
    {
      ...status.installation!,
      accountId: "123456789012",
      credentialKind: "keys",
      encryptedCredentials: "test-fixture-no-aws-access",
      accessKeyLast4: "TEST",
      defaultRegion: "us-east-1",
      credentialRevision: 1,
      setupStep: "callback",
    },
    true
  )
  importFixture("sesRegions", {
    region: "us-east-1",
    quota: {
      production: false,
      sendingEnabled: true,
      daily: 200,
      rate: 1,
      sent: 0,
    },
    checkedAt: Date.now(),
    phase: "ready",
    topicArn: "arn:aws:sns:us-east-1:123456789012:fixture",
    callbackConfirmed: false,
  })
}

export async function seedTeamTenant(page: Page, organizationId: string) {
  const rows = await (
    await client(page)
  ).query(api.tenants.list, {
    organizationId,
  })
  expect(rows).toHaveLength(1)
  const tenant = rows[0]
  importFixture(
    "sesTenants",
    {
      ...tenant,
      phase: "ready",
      error: undefined,
      arn: `arn:aws:ses:${tenant.region}:123456789012:tenant/${tenant.name}/fixture-tenant`,
      providerId: "fixture-tenant",
      sendingStatus: "ENABLED",
    },
    true
  )
}
