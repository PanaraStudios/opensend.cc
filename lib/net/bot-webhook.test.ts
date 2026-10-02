import { test } from "node:test"
import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import {
  executeBotWebhook,
  signToolRequest,
  type WebhookConfig,
} from "./bot-webhook"
import { extractKnowledgeText } from "./knowledge-text"
const config: WebhookConfig = {
  url: "https://example.test/tool",
  method: "POST",
  headers: { authorization: "Bearer sk_fixture_not_a_real_key" },
  signingSecret: "fixture-signing-secret-with-at-least-32-chars",
  parameters: {
    type: "object",
    properties: { count: { type: "number" } },
    required: ["count"],
    additionalProperties: false,
  },
  timeoutMs: 10000,
}
test("tool requests use the existing Svix HMAC body convention, caps and secret redaction", async () => {
  const headers = await signToolRequest(
    config.signingSecret,
    '{"count":0}',
    "1234567890",
    "fixture-id"
  )
  assert.equal(
    headers["svix-signature"],
    "v1," +
      createHmac("sha256", config.signingSecret)
        .update('fixture-id.1234567890.{"count":0}')
        .digest("base64")
  )
  const result = await executeBotWebhook(
    config,
    { count: 0 },
    async (url, options) => {
      assert.equal(String(url), config.url)
      assert.equal(options?.maxBytes, 8192)
      assert.equal(options?.timeoutMs, 10000)
      assert.equal(options?.body, '{"count":0}')
      assert.match(options!.headers!["svix-signature"], /^v1,/)
      return Response.json({
        header: config.headers.authorization,
        secret: config.signingSecret,
        key: "sk_fixture_not_a_real_key",
        result: "saved",
      })
    }
  )
  assert.equal(result.ok, true)
  assert.doesNotMatch(
    JSON.stringify(result),
    /sk_fixture_not_a_real_key|fixture-signing-secret/
  )
  const filtered = await executeBotWebhook(
    { ...config, resultFields: ["public"] },
    { count: 1 },
    async () => Response.json({ public: "visible", internal: "hidden" })
  )
  assert.deepEqual(filtered, { ok: true, result: { public: "visible" } })
  assert.deepEqual(
    await executeBotWebhook(config, { count: 0 }, async () =>
      Response.json({ count: 123, confirmed: false })
    ),
    { ok: true, result: { count: 123, confirmed: false } }
  )
  const expanded = await executeBotWebhook(
    { ...config, headers: { "x-secret": "a" } },
    { count: 0 },
    async () => new Response("a".repeat(1000))
  )
  assert.deepEqual(expanded, {
    ok: false,
    error: "The tool response exceeds 8 KB",
  })
})
test("tool execution rejects private hosts, enforces timeout and response limits, and returns readable failures", async () => {
  for (const url of [
    "https://127.0.0.1/x",
    "https://localhost/x",
    "http://example.test/x",
    "https://[::1]/x",
  ])
    assert.equal(
      (await executeBotWebhook({ ...config, url }, { count: 1 })).ok,
      false
    )
  const timeout = await executeBotWebhook(
    { ...config, timeoutMs: 50000 },
    { count: 1 },
    async (_url, options) => {
      assert.equal(options?.timeoutMs, 10000)
      throw new DOMException("Timed out", "TimeoutError")
    }
  )
  assert.deepEqual(timeout, { ok: false, error: "The tool endpoint timed out" })
  const capped = await executeBotWebhook(
    config,
    { count: 1 },
    async () => new Response("🟢".repeat(3000))
  )
  assert.deepEqual(capped, {
    ok: false,
    error: "The tool response exceeds 8 KB",
  })
  assert.deepEqual(
    await executeBotWebhook(
      config,
      { count: 1 },
      async () => new Response("secret details", { status: 503 })
    ),
    { ok: false, error: "The tool endpoint returned HTTP 503" }
  )
  await assert.rejects(
    executeBotWebhook(
      config,
      { count: "wrong" },
      async () => new Response("should never execute")
    ),
    /Invalid tool argument/
  )
})
test("GET encodes scalar arguments and signs an empty body", async () => {
  await executeBotWebhook(
    { ...config, method: "GET" },
    { count: 0 },
    async (url, options) => {
      assert.equal(new URL(url).searchParams.get("count"), "0")
      assert.equal(options?.body, undefined)
      return Response.json({ ok: true })
    }
  )
})
test("knowledge extraction preserves text and drops HTML scripts and navigation", async () => {
  const encode = (s: string) => new TextEncoder().encode(s)
  assert.equal(
    await extractKnowledgeText(encode("hello\nworld"), "text/plain"),
    "hello\nworld"
  )
  const html = await extractKnowledgeText(
    encode(
      "<nav>navigation</nav><main>Material &amp; answers</main><script>secret()</script>"
    ),
    "text/html"
  )
  assert.match(html, /Material & answers/)
  assert.doesNotMatch(html, /navigation|secret/)
})
test("PDF and pure-JS DOCX extraction work without executing document content", async () => {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length 40 >>\nstream\nBT /F1 12 Tf 20 200 Td (Manual text) Tj ET\nendstream",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  assert.match(
    await extractKnowledgeText(
      new TextEncoder().encode(pdf),
      "application/pdf"
    ),
    /Manual text/
  )
  const { zipSync } = await import("fflate")
  const encode = (text: string) => new TextEncoder().encode(text)
  const docx = zipSync({
    "[Content_Types].xml": encode(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    "_rels/.rels": encode(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    "word/document.xml": encode(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX reference</w:t></w:r></w:p></w:body></w:document>'
    ),
  })
  assert.match(
    await extractKnowledgeText(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    /DOCX reference/
  )
  const oversized = zipSync({
    "word/document.xml": new Uint8Array(8 * 1024 * 1024 + 1),
  })
  await assert.rejects(
    extractKnowledgeText(
      oversized,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    /expanded size/
  )
})
