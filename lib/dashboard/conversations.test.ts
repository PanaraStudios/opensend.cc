import assert from "node:assert/strict"
import { test } from "node:test"
import {
  canReply,
  replyHeaders,
  replySender,
  replySubject,
  windowLeft,
} from "./conversations"

test("a reply's subject says Re: once", () => {
  assert.equal(replySubject("Order question"), "Re: Order question")
  assert.equal(replySubject("RE: Order question"), "RE: Order question")
  assert.equal(replySubject("  "), "Re: Your message")
  assert.equal(replySubject(undefined), "Re: Your message")
})

test("threading headers answer the bracketed Message-ID", () => {
  const headers = [
    { name: "In-Reply-To", value: "<a@example.com>" },
    { name: "References", value: "<a@example.com>" },
  ]
  assert.deepEqual(replyHeaders("<a@example.com>"), headers)
  assert.deepEqual(replyHeaders("a@example.com"), headers)
  assert.deepEqual(replyHeaders(""), [])
  assert.deepEqual(replyHeaders(undefined), [])
  assert.deepEqual(replyHeaders("bad id\r\nBcc: x"), [])
})

test("free-form replies need an open window, except on email", () => {
  assert.equal(canReply({ channel: "email" }, 10), true)
  assert.equal(canReply({ channel: "whatsapp", windowExpiresAt: 11 }, 10), true)
  assert.equal(
    canReply({ channel: "whatsapp", windowExpiresAt: 10 }, 10),
    false
  )
  assert.equal(canReply({ channel: "whatsapp" }, 10), false)
})

test("the window's time left reads in hours and minutes", () => {
  assert.equal(windowLeft(3 * 3600_000 + 12 * 60_000, 0), "3h 12m")
  assert.equal(windowLeft(30_000, 0), "1m")
  assert.equal(windowLeft(0, 0), null)
  assert.equal(windowLeft(undefined, 0), null)
})

test("a reply goes from the address the email reached, on a sending domain", () => {
  const senders = ["Opensend <hello@mail.example.test>", "hello@other.test"]
  assert.equal(
    replySender(["Support <support@mail.example.test>"], senders),
    "Support <support@mail.example.test>"
  )
  assert.equal(
    replySender(["inbox@unknown.test"], senders),
    "Opensend <hello@mail.example.test>"
  )
  assert.equal(replySender([], []), undefined)
})
