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
  return execFileSync(
    "node",
    [
      "scripts/backend.mjs",
      "run",
      ...(component ? ["--component", component] : []),
      name,
      JSON.stringify(args),
    ],
    { stdio: "pipe", env: process.env, encoding: "utf8" }
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
// Synthetic ciphertext deliberately cannot authenticate an AWS request.
const connection = {
  accountId: "123456789012",
  credentialKind: "keys",
  encryptedCredentials: "test-fixture-no-aws-access",
  accessKeyLast4: "TEST",
  defaultRegion: "us-east-1",
  credentialRevision: 1,
}

export async function seedSesConnection(page: Page) {
  const status = await (await client(page)).query(api.installation.status)
  importFixture(
    "installation",
    { ...status.installation!, ...connection, setupStep: "callback" },
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

/** Sets the callback directly: a provisioned installation keeps its origin,
    so the product itself refuses to change it. */
export async function seedCallbackOrigin(page: Page, callbackOrigin: string) {
  const status = await (await client(page)).query(api.installation.status)
  importFixture(
    "installation",
    { ...status.installation!, ...connection, callbackOrigin },
    true
  )
}

export async function seedTeamTenant(page: Page, organizationId: string) {
  // A ready region implies the public HTTPS callback AWS needs; the local
  // probe that preceded this one leaves a loopback origin behind.
  await seedCallbackOrigin(page, "https://callback.opensend.test")
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

/** backend.mjs writes its target notice before the CLI's JSON result. */
export function testBackendValue<T>(
  name: string,
  args: unknown,
  component?: string
): T {
  const output = testBackend(name, args, component)
  const result = output.slice(output.indexOf("\n") + 1).trim()
  // The Convex CLI omits its default null result.
  return (result ? JSON.parse(result) : null) as T
}

export async function seedBroadcastSender(page: Page, id: string) {
  const backend = await client(page)
  const status = await backend.query(api.installation.status)
  importFixture(
    "installation",
    {
      ...status.installation!,
      ...connection,
      policyRevision: 3,
    },
    true
  )
  const region = status.regions.find((row) => row.region === "us-east-1")!
  importFixture(
    "sesRegions",
    {
      ...region,
      phase: "ready",
      checkedAt: Date.now(),
      callbackConfirmed: true,
      topicArn: "arn:aws:sns:us-east-1:123456789012:fixture",
      quota: {
        production: true,
        sendingEnabled: true,
        daily: 200,
        rate: 10,
        sent: 0,
      },
    },
    true
  )
  const found = await backend.query(api.domains.get, { id })
  expect(found).not.toBeNull()
  testBackend("domains:finish", {
    id,
    changes: {
      status: "verified",
      tenantAssociated: true,
      configurationSet: "opensend-e2e-broadcasts",
      sesVerified: true,
      dkimVerified: true,
      mailFromVerified: true,
      records: found!.domain.records.map((record) => ({
        ...record,
        status: "verified",
      })),
    },
  })
}

/** Upload through Convex's existing admin storage function, never a product endpoint. */
async function seedFile(page: Page, bytes: Buffer, contentType: string) {
  const url = testBackendValue<string>(
    "_system/frontend/fileStorageV2:generateUploadUrl",
    {}
  )
  const response = await page.request.post(url, {
    headers: { "Content-Type": contentType },
    data: bytes,
  })
  expect(response.status()).toBe(200)
  return (await response.json()).storageId as string
}

export const receivedFixture = {
  from: "Sender <sender@example.test>",
  to: "inbox@onboarding.example.test",
  subject: "Lane 6B inbound message",
  text: "Plain text received in lane 6B.",
  html: "<p>HTML received in <strong>lane 6B</strong>.</p>",
  filename: "lane-6b.txt",
  bytes: Buffer.from("Attachment from lane 6B.\n", "utf8"),
}

export async function seedReceivedMessage(
  page: Page,
  organizationId: string,
  domainId: string
) {
  const fixture = receivedFixture
  const raw = Buffer.from(
    [
      `From: ${fixture.from}`,
      `To: ${fixture.to}`,
      `Subject: ${fixture.subject}`,
      "Message-ID: <lane-6b@example.test>",
      `Received: from sender.example.test for <${fixture.to}>;`,
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="mixed-6b"',
      "",
      "--mixed-6b",
      'Content-Type: multipart/alternative; boundary="body-6b"',
      "",
      "--body-6b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      fixture.text,
      "--body-6b",
      "Content-Type: text/html; charset=utf-8",
      "",
      fixture.html,
      "--body-6b--",
      "--mixed-6b",
      "Content-Type: text/plain",
      `Content-Disposition: attachment; filename="${fixture.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      fixture.bytes.toString("base64"),
      "--mixed-6b--",
      "",
    ].join("\r\n")
  )
  const rawId = await seedFile(page, raw, "message/rfc822")
  const storageId = await seedFile(page, fixture.bytes, "text/plain")
  // S3 transfer is unavailable. Seed exactly its stored row, then commit the
  // parsed result through the real counter/outbox/idempotency transaction.
  importFixture("inboundMessages", {
    organizationId,
    domainId,
    region: "us-east-1",
    topicArn: "arn:aws:sns:us-east-1:123456789012:inbound-fixture",
    messageId: "lane-6b-sns",
    sesMessageId: "lane-6b-ses",
    bucket: "opensend-e2e-inbound",
    objectKey: `${domainId}/lane-6b-ses`,
    notification: JSON.stringify({
      notificationType: "Received",
      mail: {
        messageId: "lane-6b-ses",
        source: "sender@example.test",
        destination: [fixture.to],
      },
      receipt: {
        recipients: [fixture.to],
        action: {
          type: "S3",
          bucketName: "opensend-e2e-inbound",
          objectKey: `${domainId}/lane-6b-ses`,
        },
        spfVerdict: { status: "PASS" },
        dkimVerdict: { status: "PASS" },
        dmarcVerdict: { status: "PASS" },
      },
    }),
    storageId: rawId,
    size: raw.length,
    storedAt: Date.now(),
  })
  const rows = testBackendValue<{ page: { _id: string; messageId: string }[] }>(
    "_system/cli/tableData",
    {
      table: "inboundMessages",
      order: "desc",
      paginationOpts: { cursor: null, numItems: 10 },
    }
  )
  const inbound = rows.page.find((row) => row.messageId === "lane-6b-sns")!
  expect(inbound).toBeTruthy()
  const args = {
    id: inbound._id,
    metadata: {
      from: fixture.from,
      sender: "sender@example.test",
      to: [fixture.to],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: fixture.subject,
      messageId: "<lane-6b@example.test>",
    },
    content: {
      html: fixture.html,
      text: fixture.text,
      headers: {
        received: `from sender.example.test for <${fixture.to}>;`,
        "message-id": "<lane-6b@example.test>",
      },
    },
    attachments: [
      {
        storageId,
        filename: fixture.filename,
        contentType: "text/plain",
        contentId: null,
        contentDisposition: "attachment",
        size: fixture.bytes.length,
      },
    ],
  }
  const id = testBackendValue<string>("received:complete", args)
  expect(id).toBeTruthy()
  // A parser retry must neither duplicate the message nor emit another event.
  expect(testBackendValue<null>("received:complete", args)).toBeNull()
  return id
}
