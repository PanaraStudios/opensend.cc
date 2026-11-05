import assert from "node:assert/strict"
import { test } from "node:test"
import { senderDomainSearch } from "./sender-options"

test("sender search accepts domains and partial or complete mailboxes", () => {
  assert.equal(senderDomainSearch(" example.com "), "example.com")
  assert.equal(senderDomainSearch("hello@example"), "example")
  assert.equal(senderDomainSearch("Opensend <hello@example"), "example")
  assert.equal(
    senderDomainSearch("Opensend <hello@example.com>"),
    "example.com"
  )
})

test("sender search can clear a query or start an address domain", () => {
  assert.equal(senderDomainSearch(""), "")
  assert.equal(senderDomainSearch("  "), "")
  assert.equal(senderDomainSearch("hello@"), "")
})
