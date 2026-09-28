import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  attachmentContentType,
  attachmentNameError,
  headerError,
  parseMailbox,
  parseScheduledAt,
  searchWords,
  sesMailbox,
  templateVariableError,
} from "./email-send"

describe("parseMailbox", () => {
  it("reads bare, named and quoted addresses", () => {
    assert.deepEqual(parseMailbox(" a@b.co "), { address: "a@b.co" })
    assert.deepEqual(parseMailbox("Acme <hi@acme.dev>"), {
      name: "Acme",
      address: "hi@acme.dev",
    })
    assert.deepEqual(parseMailbox('"Doe, Jane" <jane@acme.dev>'), {
      name: "Doe, Jane",
      address: "jane@acme.dev",
    })
  })

  it("refuses malformed addresses and header injection", () => {
    for (const value of [
      "",
      "nobody",
      "a@b",
      "a b@c.co",
      "Acme <hi@acme.dev",
      "a@b.co\r\nBcc: x@y.co",
      "Acme\n <a@b.co>",
    ])
      assert.equal(parseMailbox(value), null, value)
  })
})

describe("sesMailbox", () => {
  it("quotes ASCII names and MIME-encodes the rest", () => {
    assert.equal(sesMailbox("a@b.co"), "a@b.co")
    assert.equal(sesMailbox('Doe "J" <j@b.co>'), '"Doe \\"J\\"" <j@b.co>')
    assert.equal(
      sesMailbox("Zoë <z@b.co>"),
      `=?UTF-8?B?${Buffer.from("Zoë").toString("base64")}?= <z@b.co>`
    )
  })
})

describe("parseScheduledAt", () => {
  const now = Date.parse("2026-09-28T12:00:00.000Z")
  it("takes ISO 8601 and natural language", () => {
    assert.equal(
      parseScheduledAt("2026-10-01T09:00:00.000Z", now),
      Date.parse("2026-10-01T09:00:00.000Z")
    )
    assert.equal(parseScheduledAt("in 1 min", now), now + 60_000)
    assert.equal(parseScheduledAt("in 2 hours", now), now + 7_200_000)
  })
  it("returns null for words that name no time", () => {
    assert.equal(parseScheduledAt("whenever", now), null)
    assert.equal(parseScheduledAt("2026-13-45", now), null)
  })
})

describe("headers and attachments", () => {
  it("follows SES's header rules", () => {
    assert.equal(headerError("X-Entity-Ref-ID", "123"), null)
    assert.match(headerError("Bad:Name", "x")!, /not valid/)
    assert.match(headerError("Subject", "x")!, /own fields/)
    assert.match(headerError("X-A", "line\r\nbreak")!, /not valid/)
    assert.match(headerError("X-A", "x".repeat(996))!, /not valid/)
  })
  it("refuses file types SES blocks and derives content types", () => {
    assert.equal(attachmentNameError("invoice.pdf"), null)
    assert.match(attachmentNameError("setup.EXE")!, /\.exe cannot be sent/)
    assert.match(attachmentNameError("a/b.pdf")!, /not valid/)
    assert.equal(attachmentContentType("photo.JPG"), "image/jpeg")
    assert.equal(attachmentContentType("blob"), "application/octet-stream")
  })
  it("checks template variables like Resend", () => {
    assert.equal(templateVariableError("FIRST_NAME", "Ada"), null)
    assert.equal(templateVariableError("count", 3), null)
    assert.match(templateVariableError("first-name", "x")!, /valid name/)
    assert.match(templateVariableError("long", "x".repeat(2001))!, /2000/)
  })
})

describe("searchWords", () => {
  it("splits addresses so a search can match their parts", () => {
    assert.equal(
      searchWords("jane.doe@acme.dev"),
      "jane.doe@acme.dev jane doe acme dev"
    )
  })
})
