import assert from "node:assert/strict"
import { test } from "node:test"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import { asEmail } from "../emails/use-emails"
test("email payloads use integer milliseconds and retain send failure diagnostics", () => {
  const row: Doc<"emails"> = {
    _id: "email" as Id<"emails">,
    _creationTime: 1791414141801.7012,
    domainId: "domain" as Id<"domains">,
    organizationId: "team",
    from: "hi@example.test",
    to: ["ada@example.test"],
    subject: "Hello",
    status: "failed",
    source: "api",
    generation: 0,
    attempts: 1,
    search: "Hello",
    error: "Amazon SES rejected this email",
    providerError: "MessageRejected: provider detail",
  }
  const result = asEmail(row)
  assert.equal(result.createdAt, 1791414141802)
  assert.equal(result.error, row.error)
  assert.equal(result.providerError, row.providerError)
  assert.equal(
    Number.isInteger(JSON.parse(JSON.stringify(result)).createdAt),
    true
  )
})
