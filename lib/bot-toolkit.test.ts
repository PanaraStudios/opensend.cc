import { embedText } from "./net/embedding"
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  chunkText,
  knowledgeScope,
  validateCollect,
  validateFieldValue,
  validateToolSchema,
  validateToolArguments,
  toolkitDeclarations,
} from "./bot-toolkit"
test("chunks are bounded, overlapping, Unicode safe and cover the complete document", () => {
  assert.deepEqual(chunkText(" \n "), [])
  assert.deepEqual(chunkText("abc"), ["abc"])
  const text = "0123456789".repeat(1000),
    chunks = chunkText(text)
  assert.equal(chunks[0].length, 3200)
  assert.equal(chunks[0].slice(-400), chunks[1].slice(0, 400))
  assert.equal(
    chunks[0] +
      chunks
        .slice(1)
        .map((c) => c.slice(400))
        .join(""),
    text
  )
  const unicode = chunkText("🟢".repeat(1000))
  assert.equal(Array.from(unicode[0]).length, 800)
  assert.equal(Array.from(unicode[1]).length, 300)
  assert.throws(() => chunkText("x", 10, 10))
})
test("Gemini embedding uses retrieval task, native title, header key and 768 normalized dimensions", async () => {
  const requests: {
    url: string
    init: import("./net/public-fetch").PublicFetchOptions
  }[] = []
  const fetcher: typeof import("./net/public-fetch").publicFetch = async (
    url,
    init
  ) => {
    requests.push({ url: String(url), init: init! })
    return Response.json({ embedding: { values: Array(768).fill(2) } })
  }
  const vector = await embedText(
    "sk_fixture_not_a_real_key",
    "material",
    "RETRIEVAL_DOCUMENT",
    "Manual",
    fetcher
  )
  const request = requests[0]
  assert.match(request.url, /gemini-embedding-001:embedContent$/)
  assert.equal(
    new Headers(request.init.headers).get("x-goog-api-key"),
    "sk_fixture_not_a_real_key"
  )
  assert.deepEqual(JSON.parse(String(request.init.body)), {
    model: "models/gemini-embedding-001",
    content: { parts: [{ text: "material" }] },
    taskType: "RETRIEVAL_DOCUMENT",
    outputDimensionality: 768,
    title: "Manual",
  })
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-10)
  await embedText(
    "sk_fixture_not_a_real_key",
    "question",
    "RETRIEVAL_QUERY",
    "unused",
    fetcher
  )
  assert.equal(JSON.parse(String(requests[1].init.body)).title, undefined)
  await assert.rejects(
    embedText(
      "sk_fixture_not_a_real_key",
      "x",
      "RETRIEVAL_QUERY",
      undefined,
      async () => Response.json({ embedding: { values: [1] } })
    ),
    /invalid embedding/
  )
  assert.notEqual(knowledgeScope("a", "bc"), knowledgeScope("ab", "c"))
})
test("collection validates scalar types and reserved configuration limits", () => {
  const field = {
    key: "email",
    label: "Email",
    description: "Ask for email",
    type: "email" as const,
    required: true,
  }
  assert.equal(validateFieldValue(field, " a@example.test "), "a@example.test")
  assert.throws(() => validateFieldValue(field, "broken"))
  for (const [type, good, bad] of [
    ["number", 0, "0"],
    ["boolean", false, "false"],
    ["phone", "+919999999999", "999"],
    ["date", "2026-10-03", "2026-02-30"],
    ["enum", "one", "three"],
  ] as const) {
    const f = {
      ...field,
      type,
      ...(type === "enum" ? { options: ["one", "two"] } : {}),
    }
    assert.equal(validateFieldValue(f, good), good)
    assert.throws(() => validateFieldValue(f, bad))
  }
  assert.equal(
    validateCollect([{ ...field, contactProperty: "CRM_Email" }])[0]
      .contactProperty,
    "CRM_Email"
  )
  assert.throws(() => validateCollect([field, field]), /unique/)
  assert.throws(() => validateCollect([{ ...field, type: "enum" }]), /options/)
  assert.deepEqual(
    toolkitDeclarations({ knowledgeBaseIds: ["base"], collect: [field] }).map(
      (t) => t.name
    ),
    ["search_knowledge", "save_field"]
  )
})
test("webhook schemas reject nested objects, unsafe names, references and extra arguments", () => {
  const schema = validateToolSchema({
    type: "object",
    properties: {
      count: { type: "number" },
      active: { type: "boolean" },
      choice: { type: "string", enum: ["one"] },
    },
    required: ["count", "active"],
  })
  assert.deepEqual(validateToolArguments(schema, { count: 0, active: false }), {
    count: 0,
    active: false,
  })
  for (const input of [
    { count: "0", active: false },
    { count: Infinity, active: true },
    { count: 1 },
    { count: 1, active: true, other: "bad" },
    { count: 1, active: true, choice: "two" },
  ])
    assert.throws(() => validateToolArguments(schema, input))
  for (const input of [
    { type: "object", properties: { nested: { type: "object" } } },
    { type: "object", properties: {}, $ref: "https://example.test" },
    { type: "object", properties: {}, required: ["missing"] },
    { type: "object", properties: {}, additionalProperties: true },
  ])
    assert.throws(() => validateToolSchema(input))
})
