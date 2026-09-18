import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SEED_STATE } from "./data"
import {
  canAutoConfigure,
  deriveDomainStatus,
  dnsHost,
  domainBanner,
  domainEventSteps,
  domainRecordSections,
  domainRecords,
  domainZoneFile,
  normalizeDomain,
  providerLabel,
  reconcileDomain,
  truncateMiddle,
  validateDnsLabel,
  validateDomainName,
  verifyDomainRecords,
} from "./domains"
import type { DomainEventStep } from "./domains"
import type { DnsRecord, Domain, DomainStatus } from "./types"

const NOW = Date.parse("2026-09-18T12:00:00.000Z")
const CREATED = NOW - 86_400_000
const LATER = 3_600_000

function stepAt(
  steps: readonly DomainEventStep[],
  type: DomainEventStep["type"]
): number | undefined {
  return steps.find((step) => step.type === type)?.at
}

/** Every reached step happened no earlier than the one before it. */
function assertChronological(
  steps: readonly DomainEventStep[],
  label = "trail"
) {
  const times = steps
    .map((step) => step.at)
    .filter((at): at is number => at !== undefined)
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(
      times[index] >= times[index - 1],
      `${label}: ${steps.map((step) => `${step.label} ${step.at ?? "—"}`).join(" → ")}`
    )
  }
}

function record(
  kind: DnsRecord["kind"],
  status: DomainStatus,
  overrides: Partial<DnsRecord> = {}
): DnsRecord {
  return {
    id: `rec_${kind}`,
    kind,
    type: kind === "SPF" ? "MX" : "TXT",
    name: `${kind.toLowerCase()}.example.com`,
    value: "value",
    ttl: "Auto",
    status,
    ...overrides,
  }
}

function domain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: "dom_test",
    name: "example.com",
    region: "us-east-1",
    status: "not_started",
    createdAt: CREATED,
    sending: true,
    openTracking: false,
    clickTracking: false,
    trackingSubdomain: "",
    tls: "opportunistic",
    customReturnPath: "send",
    receiving: false,
    events: [],
    records: [
      record("DKIM", "not_started"),
      record("SPF", "not_started"),
      record("DMARC", "not_started"),
    ],
    ...overrides,
  }
}

describe("validateDomainName", () => {
  it("accepts a subdomain and rejects junk", () => {
    assert.equal(validateDomainName("updates.example.com", []), null)
    assert.equal(validateDomainName("  Example.COM ", []), null)
    assert.match(String(validateDomainName("", [])), /Enter a domain/)
    assert.match(String(validateDomainName("example", [])), /valid domain/)
    assert.match(
      String(validateDomainName("https://example.com", [])),
      /valid domain/
    )
  })

  it("rejects a domain that is already added, whatever the casing", () => {
    assert.match(
      String(validateDomainName("Example.com", ["example.com"])),
      /already added/
    )
  })
})

describe("validateDnsLabel", () => {
  it("takes one label only", () => {
    assert.equal(validateDnsLabel("send"), null)
    assert.equal(validateDnsLabel("mail-01"), null)
    assert.notEqual(validateDnsLabel("send.example.com"), null)
    assert.notEqual(validateDnsLabel("-send"), null)
  })
})

describe("dnsHost", () => {
  it("strips the domain and collapses the apex", () => {
    assert.equal(dnsHost("send.example.com", "example.com"), "send")
    assert.equal(dnsHost("example.com", "example.com"), "@")
    assert.equal(dnsHost("@", "example.com"), "@")
  })
})

describe("truncateMiddle", () => {
  it("keeps both ends and leaves short values alone", () => {
    assert.equal(truncateMiddle("short", 16, 14), "short")
    const long = `${"a".repeat(20)}${"b".repeat(20)}`
    const cut = truncateMiddle(long, 16, 14)
    assert.ok(cut.startsWith("a".repeat(16)))
    assert.ok(cut.endsWith("b".repeat(14)))
    assert.ok(cut.includes("…"))
  })
})

describe("deriveDomainStatus", () => {
  it("ignores DMARC, which is recommended rather than required", () => {
    const item = domain({
      records: [
        record("DKIM", "verified"),
        record("SPF", "verified"),
        record("DMARC", "not_started"),
      ],
    })
    assert.equal(deriveDomainStatus(item), "verified")
  })

  it("is partially verified when some required records resolve", () => {
    const item = domain({
      records: [record("DKIM", "verified"), record("SPF", "not_started")],
    })
    assert.equal(deriveDomainStatus(item), "partially_verified")
  })

  it("is pending while records are looked up, and failed on any failure", () => {
    assert.equal(
      deriveDomainStatus(
        domain({
          records: [record("DKIM", "pending"), record("SPF", "not_started")],
        })
      ),
      "pending"
    )
    assert.equal(
      deriveDomainStatus(
        domain({
          records: [record("DKIM", "verified"), record("SPF", "failed")],
        })
      ),
      "failed"
    )
  })

  it("skips the sending block while sending is off", () => {
    const item = domain({
      sending: false,
      records: [record("DKIM", "verified"), record("SPF", "not_started")],
    })
    assert.equal(deriveDomainStatus(item), "verified")
  })
})

describe("domainRecords", () => {
  it("adds an inbound MX at the apex when receiving is turned on", () => {
    const item = domain({ receiving: true })
    const inbound = domainRecords(item).find(
      (entry) => entry.kind === "Receiving"
    )
    assert.ok(inbound)
    assert.equal(inbound.type, "MX")
    assert.equal(dnsHost(inbound.name, item.name), "@")
    assert.equal(inbound.value, "inbound-smtp.us-east-1.amazonaws.com")
    assert.equal(inbound.status, "not_started")
  })

  it("adds a tracking CNAME only once a subdomain and a toggle are set", () => {
    assert.equal(
      domainRecords(domain({ trackingSubdomain: "links" })).some(
        (entry) => entry.kind === "Tracking"
      ),
      false
    )
    const tracking = domainRecords(
      domain({ trackingSubdomain: "links", clickTracking: true })
    ).find((entry) => entry.kind === "Tracking")
    assert.equal(tracking?.name, "links.example.com")
  })

  it("drops the optional records again when the switch goes off", () => {
    const withInbound = reconcileDomain(domain({ receiving: true }), NOW)
    const withoutInbound = reconcileDomain(
      { ...withInbound, receiving: false },
      NOW
    )
    assert.equal(
      withoutInbound.records.some((entry) => entry.kind === "Receiving"),
      false
    )
  })
})

describe("reconcileDomain", () => {
  it("drops a verified domain to partially verified when receiving starts", () => {
    const verified = verifyDomainRecords(domain(), NOW)
    assert.equal(verified.status, "verified")
    const receiving = reconcileDomain({ ...verified, receiving: true }, NOW)
    assert.equal(receiving.status, "partially_verified")
    const checked = verifyDomainRecords(receiving, NOW)
    assert.equal(checked.status, "verified")
  })

  it("stamps each milestone once and keeps the first time", () => {
    const verified = verifyDomainRecords(domain(), NOW)
    assert.deepEqual(
      verified.events?.map((event) => event.type),
      ["added", "dns_verified", "verified"]
    )
    assert.equal(
      verified.events?.find((event) => event.type === "added")?.at,
      CREATED
    )
    const later = reconcileDomain({ ...verified, tls: "enforced" }, NOW + 1000)
    assert.equal(
      later.events?.find((event) => event.type === "verified")?.at,
      NOW
    )
  })

  it("backfills fields missing from an older persisted domain", () => {
    const legacy = {
      ...domain(),
      sending: undefined,
      trackingSubdomain: undefined,
      events: undefined,
      customReturnPath: "",
    } as unknown as Domain
    const normalized = normalizeDomain(legacy)
    assert.equal(normalized.sending, true)
    assert.equal(normalized.trackingSubdomain, "")
    assert.equal(normalized.customReturnPath, "send")
    assert.deepEqual(
      normalized.events?.map((event) => event.type),
      ["added"]
    )
  })
})

describe("seeded domains", () => {
  it("are already reconciled, so parsing a workspace changes nothing", () => {
    for (const seeded of SEED_STATE.domains) {
      assert.deepEqual(normalizeDomain(seeded), seeded, seeded.name)
    }
  })
})

describe("domainEventSteps", () => {
  it("dims the steps a domain has not reached", () => {
    const steps = domainEventSteps(domain())
    assert.deepEqual(
      steps.map((step) => step.label),
      ["Domain added", "DNS verified", "Domain verified"]
    )
    assert.equal(steps[0].at, CREATED)
    assert.equal(steps[1].at, undefined)
  })

  it("shows the partial step once that milestone applies", () => {
    const partial = reconcileDomain(
      { ...verifyDomainRecords(domain(), NOW), receiving: true },
      NOW
    )
    assert.deepEqual(
      domainEventSteps(partial).map((step) => step.label),
      ["Domain added", "DNS verified", "Partially verified", "Domain verified"]
    )
  })

  it("un-reaches the verified step while the domain is partially verified", () => {
    const verified = verifyDomainRecords(domain(), NOW)
    const partial = reconcileDomain(
      { ...verified, receiving: true },
      NOW + LATER
    )
    assert.equal(partial.status, "partially_verified")
    const steps = domainEventSteps(partial)
    assert.equal(stepAt(steps, "verified"), undefined)
    assert.equal(stepAt(steps, "partially_verified"), NOW + LATER)
    assertChronological(steps)
  })

  it("re-stamps the verified step when a domain verifies again", () => {
    const partial = reconcileDomain(
      { ...verifyDomainRecords(domain(), NOW), receiving: true },
      NOW + LATER
    )
    const again = verifyDomainRecords(partial, NOW + 2 * LATER)
    assert.equal(again.status, "verified")
    const steps = domainEventSteps(again)
    assert.equal(stepAt(steps, "verified"), NOW + 2 * LATER)
    /* The partial milestone no longer holds, so it leaves the trail. */
    assert.equal(
      steps.some((step) => step.type === "partially_verified"),
      false
    )
    assertChronological(steps)
  })

  it("keeps every reachable state in chronological order", () => {
    const fresh = reconcileDomain(domain(), NOW)
    const pending = reconcileDomain(
      domain({
        records: [record("DKIM", "pending"), record("SPF", "pending")],
      }),
      NOW
    )
    const failed = reconcileDomain(
      domain({
        records: [record("DKIM", "verified"), record("SPF", "failed")],
      }),
      NOW + LATER
    )
    const verified = verifyDomainRecords(domain(), NOW)
    const partial = reconcileDomain(
      { ...verified, receiving: true },
      NOW + LATER
    )
    const reverified = verifyDomainRecords(partial, NOW + 2 * LATER)
    const partialAgain = reconcileDomain(
      {
        ...reverified,
        receiving: false,
        clickTracking: true,
        trackingSubdomain: "links",
      },
      NOW + 3 * LATER
    )
    const states = [
      fresh,
      pending,
      failed,
      verified,
      partial,
      reverified,
      partialAgain,
    ]
    for (const state of states) {
      assertChronological(domainEventSteps(state), state.status)
    }
    assert.equal(partialAgain.status, "partially_verified")
    assert.equal(stepAt(domainEventSteps(partialAgain), "verified"), undefined)
  })
})

describe("domainRecordSections", () => {
  it("splits the records into the blocks the Records tab renders", () => {
    const sections = domainRecordSections(
      domain({ receiving: true, sending: false })
    )
    assert.deepEqual(
      sections.map((section) => section.id),
      ["verification", "sending", "receiving", "dmarc"]
    )
    assert.equal(sections[1].enabled, false)
    assert.equal(sections[2].enabled, true)
    assert.equal(sections[2].showPriority, true)
    assert.equal(sections[0].records.length, 1)
  })
})

describe("domainZoneFile", () => {
  it("writes one BIND line per record, quoting TXT values", () => {
    const item = domain({
      records: [
        record("SPF", "verified", {
          type: "MX",
          name: "send.example.com",
          value: "feedback-smtp.us-east-1.amazonses.com",
          priority: 10,
        }),
        record("DMARC", "verified", {
          type: "TXT",
          name: "_dmarc.example.com",
          value: "v=DMARC1; p=none;",
        }),
      ],
    })
    assert.deepEqual(domainZoneFile(item).split("\n"), [
      "; Opensend DNS records for example.com",
      "send.example.com.\t300\tIN\tMX\t10 feedback-smtp.us-east-1.amazonses.com.",
      '_dmarc.example.com.\t300\tIN\tTXT\t"v=DMARC1; p=none;"',
    ])
  })
})

describe("providers", () => {
  it("names the detected provider and gates auto configuration", () => {
    assert.equal(providerLabel("cloudflare"), "Cloudflare")
    assert.equal(providerLabel(undefined), "Not detected")
    assert.equal(canAutoConfigure("cloudflare"), true)
    assert.equal(canAutoConfigure("route53"), false)
    assert.equal(canAutoConfigure(undefined), false)
  })
})

describe("domainBanner", () => {
  it("gives every status a tone and a line of copy", () => {
    const statuses: DomainStatus[] = [
      "not_started",
      "pending",
      "partially_verified",
      "verified",
      "failed",
      "temporary_failure",
    ]
    for (const status of statuses) {
      const banner = domainBanner(status)
      assert.ok(banner.title.length > 0, status)
      assert.ok(banner.description.length > 0, status)
    }
    assert.equal(domainBanner("verified").tone, "success")
    assert.equal(domainBanner("failed").tone, "destructive")
  })
})
