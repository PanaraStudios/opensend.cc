import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { WorkflowId } from "@convex-dev/workflow"
import workpoolTest from "@convex-dev/workpool/test"
import { ConvexError } from "convex/values"
import { api, components, internal } from "./_generated/api"
import { fixture } from "./testHelpers/ses.fixture"
import { insertRow, patchRow } from "./counts"
import { insertEmail } from "./emailRows"
import { writeLog, LOG_RETENTION } from "./logs"
import { tokenHash } from "../lib/oauth/policy"
import { signToken } from "../lib/tokens/signed"
import { TRACKING_CONTEXT } from "../lib/tracking/html"

const secret = "hardening-test-secret-at-least-32-bytes"
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv("BETTER_AUTH_SECRET", secret)
  vi.stubEnv("SSO_ENCRYPTION_KEY", secret)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
type Fixture = Awaited<ReturnType<typeof fixture>>
async function key(f: Fixture) {
  return f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Audit", permission: "full_access" },
  })
}
async function retire(f: Fixture) {
  await f.t.run((ctx) =>
    ctx.db.insert("teamRetirements", { teamId: f.owner.team })
  )
}
async function email(
  f: Fixture,
  status: "sent" | "queued" | "scheduled" = "sent"
) {
  return f.t.run((ctx) =>
    insertEmail(
      ctx,
      {
        organizationId: f.owner.team,
        domainId: f.domain,
        from: "hi@mail.example.test",
        to: ["a@example.com"],
        subject: "Audit",
        status,
        source: "api",
        generation: 0,
        attempts: status === "scheduled" ? 0 : 1,
        ...(status === "sent"
          ? { sentAt: Date.now(), messageId: "ses-audit" }
          : {}),
        search: "audit",
      },
      { html: "<p>Audit</p>" },
      ["a@example.com"]
    )
  )
}

test("malformed route escapes return the Resend-shaped not-found response", async () => {
  const f = await fixture()
  for (const path of ["/emails/%", "/templates/%E0%A4%A", "/contacts/%FF"]) {
    const response = await f.t.fetch(path)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      statusCode: 404,
      name: "not_found",
      message: "The requested endpoint does not exist.",
    })
  }
})

test("API-key creation and replay preserve the token but request logs redact it", async () => {
  const f = await fixture()
  const { token } = await key(f)
  const request = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": "audit-create",
    },
    body: JSON.stringify({ name: "Created through REST" }),
  }
  const first = await f.t.fetch("/api-keys", request)
  expect(first.status).toBe(201)
  const created = await first.json()
  expect(created.token).toMatch(/^os_/)
  expect(await (await f.t.fetch("/api-keys", request)).json()).toEqual(created)
  const logs = await f.owner.client.query(api.logs.list, {
    organizationId: f.owner.team,
    paginationOpts: { cursor: null, numItems: 10 },
  })
  expect(logs.page).toHaveLength(2)
  for (const log of logs.page) {
    const detail = await f.owner.client.query(api.logs.get, { id: log._id })
    expect(detail!.body!.responseBody).toContain('"token":"[redacted]"')
    expect(JSON.stringify(detail)).not.toContain(created.token)
    expect(JSON.stringify(detail)).not.toContain(token)
  }
  const stored = await f.t.run((ctx) => ctx.db.query("apiLogBodies").take(10))
  expect(JSON.stringify(stored)).not.toContain(created.token)
})

test("legacy key response logs are redacted on read and remain team protected", async () => {
  const f = await fixture()
  const logId = await f.t.run(async (ctx) => {
    const id = await writeLog(ctx, f.owner.team, {
      method: "POST",
      path: "/api-keys",
      status: 200,
      durationMs: 0,
      userAgent: "audit",
      source: "api",
      requestHeaders: [],
    })
    const body = (await ctx.db.query("apiLogBodies").first())!
    await ctx.db.patch("apiLogBodies", body._id, {
      responseBody: '{"token":"old-secret',
    })
    return id
  })
  expect(
    (await f.owner.client.query(api.logs.get, { id: logId }))!.body!
      .responseBody
  ).toBe("[redacted]")
  await expect(
    f.outsider.client.query(api.logs.get, { id: logId })
  ).rejects.toThrow("permission")
})

test("a plain member still writes product data and invalid input stays readable", async () => {
  const f = await fixture()
  const member = await f.actor("member")
  await f.t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "member",
      data: {
        organizationId: f.owner.team,
        userId: member.user._id,
        role: "member",
        createdAt: Date.now(),
      },
    },
  })
  const created = await member.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Member key", permission: "full_access" },
  })
  expect(created.token).toMatch(/^os_/)
  await expect(
    member.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: { name: " ", permission: "full_access" },
    })
  ).rejects.toThrow("Enter a name")
  await expect(
    f.outsider.client.action(api.apiKeys.create, {
      organizationId: f.owner.team,
      input: { name: "Foreign", permission: "full_access" },
    })
  ).rejects.toThrow("permission")
  await expect(
    member.client.action(api.sso.save, {
      organizationId: f.owner.team,
      issuer: "invalid",
      clientId: "client",
      clientSecret: "secret",
    })
  ).rejects.toThrow("permission")
})

test("malformed SSO issuers raise a readable ConvexError after admin authorization", async () => {
  const f = await fixture()
  const args = {
    organizationId: f.owner.team,
    issuer: "not a URL",
    clientId: "client",
    clientSecret: "secret",
  }
  await expect(
    f.owner.client.action(api.sso.save, args)
  ).rejects.toBeInstanceOf(ConvexError)
  await expect(f.owner.client.action(api.sso.save, args)).rejects.toThrow(
    "Enter a valid issuer, client ID, and secret"
  )
  await expect(f.outsider.client.action(api.sso.save, args)).rejects.toThrow(
    "permission"
  )
})

test("API transactions refuse a key whose permission changed after authentication", async () => {
  const f = await fixture()
  const created = await key(f)
  const begun = await f.t.mutation(internal.api.state.begin, {
    credential: { kind: "key", tokenHash: await tokenHash(created.token) },
    scope: "full_access",
  })
  if (begun.kind !== "ok") throw new Error("Expected authenticated caller")
  await f.owner.client.mutation(api.apiKeys.update, {
    id: created.id,
    patch: { permission: "sending_access" },
  })
  await expect(
    f.t.query(internal.api.keys.list, { caller: begun.caller, limit: 10 })
  ).rejects.toThrow("API key is invalid")
})

test("API transactions refuse a sending domain removed after authentication", async () => {
  const f = await fixture()
  const created = await f.owner.client.action(api.apiKeys.create, {
    organizationId: f.owner.team,
    input: { name: "Sender", permission: "sending_access", domainId: f.domain },
  })
  const begun = await f.t.mutation(internal.api.state.begin, {
    credential: { kind: "key", tokenHash: await tokenHash(created.token) },
    scope: { resource: "emails", access: "write" },
    emailSending: true,
  })
  if (begun.kind !== "ok") throw new Error("Expected authenticated caller")
  await f.t.run((ctx) => patchRow(ctx, "domains", f.domain, { deleted: true }))
  const { requireCaller } = await import("./api/caller")
  await expect(
    f.t.run((ctx) => requireCaller(ctx, begun.caller, "sending"))
  ).rejects.toThrow("API key is invalid")
})

test("auth POST bodies are bounded before parsing or invoking the provider", async () => {
  const f = await fixture()
  const response = await f.t.fetch("/api/auth/sign-in/oauth2", {
    method: "POST",
    body: "x".repeat(1_048_577),
  })
  expect(response.status).toBe(413)
  expect(await response.json()).toEqual({
    message: "The request body is too large.",
  })
})

test("request-log retention makes bounded progress and schedules the remainder", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 9; i++)
      await writeLog(ctx, f.owner.team, {
        method: "POST",
        path: "/emails",
        status: 200,
        durationMs: 0,
        userAgent: "audit",
        source: "api",
        requestHeaders: [],
        requestBody: "😀".repeat(32_768),
        responseBody: "😀".repeat(32_768),
      })
  })
  vi.setSystemTime(Date.now() + LOG_RETENTION + 1)
  await f.t.mutation(internal.logs.prune, {})
  expect(await f.t.run((ctx) => ctx.db.query("apiLogs").take(10))).toHaveLength(
    1
  )
  expect(
    await f.t.run((ctx) => ctx.db.query("apiLogBodies").take(10))
  ).toHaveLength(1)
  const scheduled = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(100)
  )
  expect(scheduled.some((job) => job.name === "logs:prune")).toBe(true)
  await f.t.mutation(internal.logs.prune, {})
  expect(await f.t.run((ctx) => ctx.db.query("apiLogs").take(10))).toHaveLength(
    0
  )
})

test("tracking links stop at retirement before cleanup reaches the email", async () => {
  const f = await fixture()
  const id = await email(f)
  await f.t.run((ctx) =>
    ctx.db.insert("emailTracking", {
      emailId: id,
      origin: "https://api.opensend.test",
      open: true,
      click: true,
      links: ["https://example.com"],
    })
  )
  await retire(f)
  const result = await f.t.mutation(internal.tracking.hit, {
    token: await signToken(`${id}.0`, TRACKING_CONTEXT, secret),
    kind: "c",
    userAgent: "",
    ipAddress: "",
  })
  expect(result).toBeNull()
  expect(
    await f.t.run((ctx) => ctx.db.query("emailEvents").take(10))
  ).toHaveLength(1)
})

test("late SES projections tolerate retirement without creating timeline or suppression rows", async () => {
  const f = await fixture()
  const id = await email(f)
  const event = await f.t.run((ctx) =>
    ctx.db.insert("sesEvents", {
      topicArn: "arn:aws:sns:us-east-1:123456789012:opensend-events",
      messageId: "sns-audit",
      message: JSON.stringify({
        eventType: "Bounce",
        mail: {
          messageId: "ses-audit",
          tags: { opensend_email: [id], opensend_team: [f.owner.team] },
        },
        bounce: {
          bounceType: "Permanent",
          bouncedRecipients: [{ emailAddress: "a@example.com" }],
        },
      }),
    })
  )
  await retire(f)
  await f.t.mutation(internal.ses.projection.project, { id: event, attempt: 6 })
  expect(
    await f.t.run((ctx) => ctx.db.query("emailEvents").take(10))
  ).toHaveLength(1)
  expect(
    await f.t.run((ctx) => ctx.db.query("suppressions").take(10))
  ).toHaveLength(0)
})

test("scheduled releases and in-flight send completions tolerate retirement", async () => {
  const f = await fixture()
  const queued = await email(f, "queued")
  const scheduled = await email(f, "scheduled")
  await retire(f)
  await f.t.mutation(internal.emails.release, { id: scheduled, generation: 0 })
  await f.t.mutation(internal.emails.record, {
    id: queued,
    generation: 0,
    outcome: { kind: "sent", messageId: "late-send" },
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("emails", scheduled)))!.status
  ).toBe("scheduled")
  expect(
    (await f.t.run((ctx) => ctx.db.get("emails", queued)))!.sentAt
  ).toBeUndefined()
})

test("export completion deletes a late file and sends no notification for a retired team", async () => {
  const f = await fixture()
  const id = await f.owner.client.mutation(api.exports.start, {
    organizationId: f.owner.team,
    resource: "contacts",
    filters: {},
    summary: [],
  })
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["email\na@example.com"]))
  )
  await retire(f)
  expect(await f.t.query(internal.exports.job, { id })).toBeNull()
  await f.t.mutation(internal.exports.finish, { id, storageId, rows: 1001 })
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
  expect((await f.t.run((ctx) => ctx.db.get("exports", id)))!.status).toBe(
    "processing"
  )
  await f.t.run(async (ctx) => {
    await patchRow(ctx, "exports", id, { status: "ready", rows: 1001 })
    await ctx.db.patch("installation", f.installation, {
      systemSender: { from: "hi@mail.example.test", domainId: f.domain },
    })
  })
  await f.t.mutation(internal.exports.emailCreator, { id })
  expect(await f.t.run((ctx) => ctx.db.query("emails").take(10))).toHaveLength(
    0
  )
})

async function inbound(f: Fixture) {
  return f.t.run((ctx) =>
    ctx.db.insert("inboundMessages", {
      organizationId: f.owner.team,
      domainId: f.domain,
      region: "us-east-1",
      topicArn: "topic",
      messageId: "sns",
      sesMessageId: "ses",
      bucket: "bucket",
      objectKey: `${f.domain}/ses`,
      notification: "{}",
    })
  )
}
test("inbound completion callbacks tolerate rows removed during transfer", async () => {
  const f = await fixture()
  const id = await inbound(f)
  await f.t.run((ctx) => ctx.db.delete("inboundMessages", id))
  await f.t.mutation(internal.ses.inboundMessages.deleted, { id })
  await f.t.mutation(internal.ses.inboundMessages.reject, { id })
  await f.t.mutation(internal.ses.inboundMessages.transferDone, {
    workId: "work" as never,
    context: { id },
    result: { kind: "failed", error: "late failure" },
  })
  expect(await f.t.query(internal.ses.inboundMessages.get, { id })).toBeNull()
})
test("inbound workers discard late uploads and skip retries after retirement", async () => {
  const f = await fixture()
  const id = await inbound(f)
  const storageId = await f.t.run((ctx) =>
    ctx.storage.store(new Blob(["late message"]))
  )
  await retire(f)
  expect(await f.t.query(internal.ses.inboundMessages.get, { id })).toBeNull()
  await f.t.mutation(internal.ses.inboundMessages.stored, {
    id,
    storageId,
    size: 12,
  })
  await f.t.mutation(internal.ses.inboundMessages.retry, { id })
  expect(await f.t.run((ctx) => ctx.storage.get(storageId))).toBeNull()
  expect(
    (await f.t.run((ctx) => ctx.db.get("inboundMessages", id)))!.storageId
  ).toBeUndefined()
})

test("webhook fanout and completion stop when their team retires", async () => {
  const f = await fixture()
  workpoolTest.register(f.t, "webhookPool")
  const webhook = await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://example.com/hook",
    events: ["contact.created"],
  })
  const event = await f.t.run((ctx) =>
    ctx.db.insert("events", {
      organizationId: f.owner.team,
      type: "contact.created",
      data: { id: "contact" },
    })
  )
  const delivery = await f.t.run((ctx) =>
    insertRow(ctx, "webhookDeliveries", {
      organizationId: f.owner.team,
      webhookId: webhook,
      messageId: "msg_audit",
      event: "contact.created",
      payload: {},
      replay: false,
      status: 0,
      failed: true,
      attempts: 0,
      durationMs: 0,
      response: "",
    })
  )
  await retire(f)
  await f.t.mutation(internal.webhooks.deliverEvent, { id: event })
  await f.t.mutation(internal.webhooks.recordAttempt, {
    id: delivery,
    attempt: 0,
    status: 500,
    durationMs: 1,
    response: "retry",
  })
  expect(
    await f.t.run((ctx) => ctx.db.query("webhookDeliveries").take(10))
  ).toHaveLength(1)
  expect(
    (await f.t.run((ctx) => ctx.db.get("webhookDeliveries", delivery)))!
      .attempts
  ).toBe(0)
})

test("legacy API-key secrets are also redacted through REST log retrieval", async () => {
  const f = await fixture()
  const { token } = await key(f)
  const id = await f.t.run(async (ctx) => {
    const logId = await writeLog(ctx, f.owner.team, {
      method: "POST",
      path: "/api-keys",
      status: 200,
      durationMs: 0,
      userAgent: "audit",
      source: "api",
      requestHeaders: [],
    })
    const body = (await ctx.db.query("apiLogBodies").first())!
    await ctx.db.patch("apiLogBodies", body._id, {
      responseBody: JSON.stringify({ id: "key", token: "legacy-secret" }),
    })
    return logId
  })
  const response = await f.t.fetch(`/logs/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.response_body).toEqual({ id: "key", token: "[redacted]" })
})

test("OAuth body limits count streamed bytes rather than UTF-16 characters", async () => {
  const f = await fixture()
  const response = await f.t.fetch("/oauth/token", {
    method: "POST",
    body: `client_id=${"😀".repeat(5000)}`,
  })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({
    error: "invalid_request",
    error_description: "Request too large",
  })
})

test("retired broadcasts do not start another workflow from a completion callback", async () => {
  const f = await fixture()
  const id = await f.owner.client.mutation(api.broadcasts.create, {
    organizationId: f.owner.team,
  })
  const workflowId = await f.t.mutation(components.workflow.workflow.create, {
    workflowName: "audit",
    workflowHandle: "unused",
    workflowArgs: {},
    createOnly: true,
  })
  await f.t.run((ctx) =>
    patchRow(ctx, "broadcasts", id, {
      status: "queued",
      workflowId: workflowId as WorkflowId,
      generation: 1,
    })
  )
  await retire(f)
  await f.t.mutation(internal.broadcastSend.completed, {
    workflowId: workflowId as WorkflowId,
    context: { id, generation: 1 },
    result: { kind: "success", returnValue: null },
  })
  expect(
    (await f.t.run((ctx) => ctx.db.get("broadcasts", id)))!.workflowId
  ).toBe(workflowId)
})

test("webhook retention bounds payload bytes and continues partial batches", async () => {
  const f = await fixture()
  const webhook = await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://example.com/hook",
    events: ["contact.created"],
  })
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 10; i++) {
      const payload = { data: "x".repeat(400_000) }
      await ctx.db.insert("events", {
        organizationId: f.owner.team,
        type: "custom.audit",
        data: payload,
      })
      await insertRow(ctx, "webhookDeliveries", {
        organizationId: f.owner.team,
        webhookId: webhook,
        messageId: `msg_${i}`,
        event: "contact.created",
        payload,
        replay: false,
        status: 200,
        failed: false,
        attempts: 1,
        durationMs: 0,
        response: "",
      })
    }
  })
  vi.setSystemTime(Date.now() + 91 * 86_400_000)
  await f.t.mutation(internal.webhooks.cleanup, {})
  const left = await f.t.run((ctx) =>
    ctx.db.query("webhookDeliveries").take(20)
  )
  expect(left.length).toBeGreaterThan(0)
  expect(left.length).toBeLessThan(10)
  await f.t.mutation(internal.webhooks.cleanup, {})
  expect(
    await f.t.run((ctx) => ctx.db.query("webhookDeliveries").take(20))
  ).toHaveLength(0)
  expect(await f.t.run((ctx) => ctx.db.query("events").take(20))).toHaveLength(
    0
  )
})

test("webhook removal bounds delivery payload bytes while draining all batches", async () => {
  const f = await fixture()
  const webhook = await f.owner.client.action(api.webhooks.create, {
    organizationId: f.owner.team,
    endpoint: "https://example.com/hook",
    events: ["contact.created"],
  })
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 10; i++)
      await insertRow(ctx, "webhookDeliveries", {
        organizationId: f.owner.team,
        webhookId: webhook,
        messageId: `msg_${i}`,
        event: "contact.created",
        payload: { data: "x".repeat(400_000) },
        replay: false,
        status: 200,
        failed: false,
        attempts: 1,
        durationMs: 0,
        response: "",
      })
  })
  await f.t.mutation(internal.webhooks.purgeDeliveries, { webhookId: webhook })
  const left = await f.t.run((ctx) =>
    ctx.db.query("webhookDeliveries").take(20)
  )
  expect(left.length).toBeGreaterThan(0)
  expect(left.length).toBeLessThan(10)
  await f.t.mutation(internal.webhooks.purgeDeliveries, { webhookId: webhook })
  expect(
    await f.t.run((ctx) => ctx.db.query("webhookDeliveries").take(20))
  ).toHaveLength(0)
})

test("SES workflow cleanup accepts only its documented null context", async () => {
  const f = await fixture()
  const workflowId = await f.t.mutation(components.workflow.workflow.create, {
    workflowName: "audit",
    workflowHandle: "unused",
    workflowArgs: {},
    createOnly: true,
  })
  await f.t.mutation(internal.ses.workflows.cleanup, {
    workflowId: workflowId as WorkflowId,
    result: { kind: "success", returnValue: null },
    context: null,
  })
  await expect(
    f.t.mutation(internal.ses.workflows.cleanup, {
      workflowId: workflowId as WorkflowId,
      result: { kind: "success", returnValue: null },
      context: {} as never,
    })
  ).rejects.toThrow()
})

test("expired export row cleanup schedules its backlog without newly expired files", async () => {
  const f = await fixture()
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 101; i++)
      await insertRow(ctx, "exports", {
        organizationId: f.owner.team,
        resource: "contacts",
        status: "expired",
        filters: {},
        rows: 0,
        expiresAt: Date.now() - 31 * 86_400_000,
      })
  })
  await f.t.mutation(internal.exports.expire, {})
  expect(await f.t.run((ctx) => ctx.db.query("exports").take(10))).toHaveLength(
    1
  )
  const jobs = await f.t.run((ctx) =>
    ctx.db.system.query("_scheduled_functions").take(100)
  )
  expect(jobs.some((job) => job.name === "exports:expire")).toBe(true)
  await f.t.mutation(internal.exports.expire, {})
  expect(await f.t.run((ctx) => ctx.db.query("exports").take(10))).toHaveLength(
    0
  )
})

test("domain exports report the configured tracking flags", async () => {
  const f = await fixture()
  const { EXPORT_SOURCES } = await import("./exportSources")
  await f.t.run((ctx) =>
    patchRow(ctx, "domains", f.domain, {
      openTracking: true,
      clickTracking: true,
    })
  )
  const page = await f.t.run((ctx) =>
    EXPORT_SOURCES.domains.page(
      ctx,
      f.owner.team,
      {},
      { cursor: null, numItems: 10 },
      []
    )
  )
  const columns = EXPORT_SOURCES.domains.columns
  expect(page.rows[0][columns.indexOf("open_track")]).toBe("true")
  expect(page.rows[0][columns.indexOf("click_track")]).toBe("true")
})

test("received email HTML falls back to cid before an inline image exceeds transport limits", async () => {
  const f = await fixture()
  const { token } = await key(f)
  const inboundId = await inbound(f)
  const id = await f.t.run(async (ctx) => {
    const rawId = await ctx.storage.store(new Blob(["message"]))
    const id = await insertRow(ctx, "receivedEmails", {
      organizationId: f.owner.team,
      inboundId,
      domainId: f.domain,
      from: "a@example.com",
      sender: "a@example.com",
      to: ["hi@mail.example.test"],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: "Large image",
      messageId: "large-image",
      receivedFor: [],
      authentication: {},
      receivedAt: Date.now(),
      expiresAt: Date.now() + 86_400_000,
      rawId,
    })
    await ctx.db.insert("receivedContents", {
      emailId: id,
      html: '<img src="cid:large">',
      text: "",
      headers: {},
    })
    const storageId = await ctx.storage.store(
      new Blob([new Uint8Array(7 * 1024 * 1024)])
    )
    await ctx.db.insert("receivedAttachments", {
      emailId: id,
      storageId,
      size: 7 * 1024 * 1024,
      filename: "large.png",
      contentType: "image/png",
      contentId: "large",
      contentDisposition: "inline",
    })
    return id
  })
  const response = await f.t.fetch(`/emails/receiving/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    html: '<img src="cid:large">',
    html_format: "cid",
  })
})
