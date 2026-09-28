import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { once } from "node:events"
import nodemailer from "nodemailer"
import SMTPConnection from "nodemailer/lib/smtp-connection/index.js"
import { createSmtpServer, parseMessage, MAX_MESSAGE_BYTES } from "./server.mjs"

let directory, key, cert
before(() => {
  directory = mkdtempSync(join(tmpdir(), "opensend-smtp-"))
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(directory, "key.pem"),
      "-out",
      join(directory, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
    ],
    { stdio: "ignore" }
  )
  key = readFileSync(join(directory, "key.pem"))
  cert = readFileSync(join(directory, "cert.pem"))
})
after(() => rmSync(directory, { recursive: true, force: true }))

async function fixture(t, { secure = false, maxMessageBytes } = {}) {
  const calls = []
  let enabled = true,
    status = 200,
    errorName
  const backend = createServer(async (req, res) => {
    let body = ""
    for await (const chunk of req) body += chunk
    calls.push({
      path: req.url,
      headers: req.headers,
      body: body ? JSON.parse(body) : undefined,
    })
    res.setHeader("content-type", "application/json")
    res.statusCode =
      req.headers.authorization !== "Bearer os_good" || !enabled ? 403 : status
    res.end(
      JSON.stringify(
        res.statusCode === 200
          ? req.url === "/smtp/auth"
            ? { authenticated: true }
            : { id: "email-123" }
          : { name: errorName ?? "smtp_disabled" }
      )
    )
  })
  backend.listen(0, "127.0.0.1")
  await once(backend, "listening")
  const server = createSmtpServer({
    convexSiteUrl: `http://127.0.0.1:${backend.address().port}`,
    key,
    cert,
    name: "localhost",
    secure,
    maxMessageBytes,
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const options = {
    host: "127.0.0.1",
    port: server.server.address().port,
    secure,
    tls: { rejectUnauthorized: false },
    auth: { user: "opensend", pass: "os_good" },
    connectionTimeout: 3000,
    greetingTimeout: 3000,
    socketTimeout: 3000,
  }
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    await new Promise((resolve) => backend.close(resolve))
  })
  const send = (message = {}, overrides = {}) =>
    nodemailer
      .createTransport({ ...options, ...overrides })
      .sendMail({
        from: "hi@example.com",
        to: "ada@example.net",
        subject: "Hello",
        text: "Welcome",
        ...message,
      })
  return {
    send,
    calls,
    options,
    disable: () => {
      enabled = false
    },
    fail: (code, name) => {
      status = code
      errorName = name
    },
  }
}

for (const secure of [false, true])
  test(`${secure ? "implicit TLS" : "STARTTLS"} supports authenticated submission`, async (t) => {
    const f = await fixture(t, { secure })
    const sent = await f.send({}, { authMethod: secure ? "LOGIN" : "PLAIN" })
    assert.match(sent.response, /250 Queued as email-123/)
    assert.deepEqual(
      f.calls.map((call) => call.path),
      ["/smtp/auth", "/smtp/emails"]
    )
  })

test("AUTH is required", async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.send({}, { auth: undefined, requireTLS: true }), {
    responseCode: 530,
  })
  assert.equal(f.calls.length, 0)
})

test("AUTH before TLS is refused", async (t) => {
  const f = await fixture(t)
  await assert.rejects(f.send({}, { ignoreTLS: true }), { responseCode: 538 })
  assert.equal(f.calls.length, 0)
})

test("wrong username and key are refused", async (t) => {
  const f = await fixture(t)
  for (const auth of [
    { user: "resend", pass: "os_good" },
    { user: "opensend", pass: "os_bad" },
  ])
    await assert.rejects(f.send({}, { auth }), { responseCode: 535 })
  assert.equal(f.calls.length, 1)
})

test("disabled team cannot authenticate", async (t) => {
  const f = await fixture(t)
  f.disable()
  await assert.rejects(f.send(), { responseCode: 535 })
  assert.equal(f.calls.length, 1)
})

test("disablement is rechecked for an already authenticated session", async (t) => {
  const f = await fixture(t)
  const connection = new SMTPConnection(f.options)
  await new Promise((resolve, reject) => {
    connection.on("error", reject)
    connection.connect(resolve)
  })
  await new Promise((resolve, reject) =>
    connection.login(f.options.auth, (err) => (err ? reject(err) : resolve()))
  )
  f.disable()
  await assert.rejects(
    new Promise((resolve, reject) =>
      connection.send(
        { from: "hi@example.com", to: ["ada@example.net"] },
        "From: hi@example.com\r\nSubject: Hello\r\n\r\nTest",
        (err, info) => (err ? reject(err) : resolve(info))
      )
    ),
    { responseCode: 554 }
  )
  connection.close()
})

test("MIME fields, inline attachments, envelope Bcc and idempotency are forwarded", async (t) => {
  const f = await fixture(t)
  await f.send({
    from: "Sender <hi@example.com>",
    to: "Ada <ada@example.net>",
    cc: "cc@example.net",
    bcc: "secret@example.net",
    replyTo: "reply@example.com",
    text: "plain",
    html: '<b>rich</b><img src="cid:logo">',
    headers: {
      "X-Entity-Ref-ID": "test-ref",
      "Opensend-Idempotency-Key": "welcome/1",
    },
    attachments: [
      {
        filename: "logo.png",
        content: Buffer.from("image"),
        contentType: "image/png",
        cid: "logo",
      },
    ],
  })
  const call = f.calls[1]
  assert.equal(call.headers["idempotency-key"], "welcome/1")
  assert.equal(call.body.from, "Sender <hi@example.com>")
  assert.deepEqual(call.body.to, ["Ada <ada@example.net>"])
  assert.deepEqual(call.body.cc, ["cc@example.net"])
  assert.deepEqual(call.body.bcc, ["secret@example.net"])
  assert.deepEqual(call.body.reply_to, ["reply@example.com"])
  assert.equal(call.body.subject, "Hello")
  assert.equal(call.body.text.trim(), "plain")
  assert.match(call.body.html, /cid:logo/)
  assert.equal(call.body.headers["x-entity-ref-id"], "test-ref")
  assert.equal(call.body.headers["opensend-idempotency-key"], undefined)
  assert.deepEqual(call.body.attachments[0], {
    filename: "logo.png",
    content: Buffer.from("image").toString("base64"),
    content_type: "image/png",
    content_id: "logo",
  })
})

test("MIME header recipients cannot add delivery recipients", async () => {
  const parsed = await parseMessage(
    Buffer.from(
      "From: hi@example.com\r\nTo: injected@example.net\r\nSubject: Hello\r\n\r\nBody"
    ),
    ["actual@example.net"]
  )
  assert.deepEqual(parsed.body.to, [])
  assert.deepEqual(parsed.body.bcc, ["actual@example.net"])
})

test("display names are quoted only when they need it", async () => {
  const parsed = await parseMessage(
    Buffer.from(
      'From: "Acme, Inc." <hi@example.com>\r\nTo: QA Team <a@example.net>\r\nSubject: Hi\r\n\r\nBody'
    ),
    ["a@example.net"]
  )
  assert.equal(parsed.body.from, '"Acme, Inc." <hi@example.com>')
  assert.deepEqual(parsed.body.to, ["QA Team <a@example.net>"])
})

test("oversized DATA is rejected without submitting to Convex", async (t) => {
  const f = await fixture(t, { maxMessageBytes: 512 })
  await assert.rejects(f.send({ text: "x".repeat(2000) }), {
    responseCode: 552,
  })
  assert.equal(f.calls.filter((call) => call.path === "/smtp/emails").length, 0)
})

test("temporary failures remain retryable", async (t) => {
  const f = await fixture(t)
  f.fail(429)
  await assert.rejects(f.send(), { responseCode: 451 })
  f.fail(503)
  await assert.rejects(f.send(), { responseCode: 451 })
})

test("invalid TLS configuration and oversized configured limit fail closed", () => {
  assert.throws(
    () => createSmtpServer({ convexSiteUrl: "http://localhost" }),
    /certificate/
  )
  assert.throws(
    () =>
      createSmtpServer({
        convexSiteUrl: "http://localhost",
        key,
        cert,
        maxMessageBytes: MAX_MESSAGE_BYTES + 1,
      }),
    /size limit/
  )
})
