import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"

import {
  linkKey,
  parseSponsorTier,
  sponsorPaymentLink,
} from "./sponsor-checkout"
import { logoFilename, logoType } from "./sponsor-logo"

const NAMES = [
  "STRIPE_PAYMENT_LINK_GOLD",
  "STRIPE_PAYMENT_LINK_SILVER",
  "NEXT_PUBLIC_STRIPE_PAYMENT_LINK_GOLD",
  "NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER",
]

describe("sponsor payment links", () => {
  afterEach(() => {
    for (const name of NAMES) delete process.env[name]
  })

  it("keeps the link as pasted, and compares links without their query", () => {
    process.env.STRIPE_PAYMENT_LINK_GOLD =
      " https://buy.stripe.com/abc?prefilled_promo_code=LAUNCH "
    const link = sponsorPaymentLink("gold")
    assert.equal(link, "https://buy.stripe.com/abc?prefilled_promo_code=LAUNCH")
    assert.equal(linkKey(link!), "https://buy.stripe.com/abc")
    assert.equal(linkKey("https://buy.stripe.com/abc/"), linkKey(link!))
  })

  it("falls back to the older name when the new one is empty", () => {
    process.env.STRIPE_PAYMENT_LINK_SILVER = ""
    process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER =
      "https://buy.stripe.com/old"
    assert.equal(sponsorPaymentLink("silver"), "https://buy.stripe.com/old")
  })

  it("has no link when none is set, or what is set is no URL", () => {
    assert.equal(sponsorPaymentLink("gold"), null)
    process.env.STRIPE_PAYMENT_LINK_GOLD = "soon"
    assert.equal(sponsorPaymentLink("gold"), null)
  })

  it("knows a tier id from anything else", () => {
    assert.equal(parseSponsorTier("gold"), "gold")
    assert.equal(parseSponsorTier("platinum"), null)
    assert.equal(parseSponsorTier(undefined), null)
  })
})

describe("sponsor logos", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type })

  it("goes by the name, and wants the browser to agree", () => {
    assert.equal(logoType(file("logo.svg", "image/svg+xml")), "image/svg+xml")
    assert.equal(logoType(file("LOGO.JPG", "")), "image/jpeg")
    assert.equal(logoType(file("logo.html", "image/png")), null)
    assert.equal(logoType(file("logo.svg.exe", "image/svg+xml")), null)
    assert.equal(logoType(file("logo.png", "image/svg+xml")), null)
    assert.equal(logoType(file("logo", "image/png")), null)
  })

  it("names the attachment itself", () => {
    assert.equal(
      logoFilename(file("../../evil name.PNG", "image/png"), "logo-dark"),
      "logo-dark.png"
    )
  })
})
