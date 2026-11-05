import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { CHANNELS, CHANNEL_IDS } from "../channels"
import { format } from "date-fns"
import {
  AUTOMATION_RUN_STATUS_TONE,
  BROADCAST_STATUS_TONE,
  CHANNEL_MESSAGE_STATUS_TONE,
  EMAIL_STATUS_TONE,
  SKIP_REASON_TONE,
  automationStatusLabel,
  broadcastStatusLabel,
  channelLabel,
  codeLabel,
  defaultFromAddress,
  emailStatusLabel,
  exportStatusLabel,
  fieldTypeLabel,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelative,
  metaTemplateStatusLabel,
  tenantStatusLabel,
  httpStatusLabel,
  httpStatusTone,
  initials,
  isDomainName,
  isEmail,
  isHttpsUrl,
  isUrl,
  maskToken,
  messagingLimitLabel,
  normalizeEmail,
  normalizeHref,
  percent,
  permissionLabel,
  pluralize,
  rate,
  regionLabel,
  roleLabel,
  sentenceCase,
  skipReasonLabel,
  statusLabel,
  suppressionReasonLabel,
  templateStatusLabel,
} from "./format"
import { REGIONS } from "./types"
import type {
  ApiKeyPermission,
  AutomationStatus,
  BroadcastStatus,
  DomainStatus,
  EmailStatus,
  ExportStatus,
  MemberRole,
  Region,
  SkipReason,
  SuppressionReason,
  TemplateStatus,
} from "./types"

describe("readable codes", () => {
  it("sentence-cases stored codes and field types", () => {
    assert.equal(codeLabel("payment_updated"), "Payment updated")
    assert.equal(codeLabel("First_Name"), "First Name")
    assert.equal(fieldTypeLabel("string"), "String")
    assert.equal(fieldTypeLabel("boolean"), "Boolean")
    assert.equal(fieldTypeLabel("enum"), "Choice")
    assert.equal(fieldTypeLabel("array"), "List")
    assert.equal(fieldTypeLabel("payment_updated"), "Payment updated")
  })
})

describe("normalizeHref", () => {
  it("keeps web addresses, mail and phone links, anchors and merge tags", () => {
    for (const href of [
      "https://opensend.cc/a?b=1",
      "http://example.com",
      "mailto:hello@opensend.cc",
      "tel:+15551234567",
      "#pricing",
      "{{{OPENSEND_UNSUBSCRIBE_URL}}}",
    ]) {
      assert.equal(normalizeHref(href), href)
    }
  })

  it("reads a bare domain as https", () => {
    assert.equal(
      normalizeHref(" example.com/pricing "),
      "https://example.com/pricing"
    )
  })

  it("refuses anything that would run or is not an address", () => {
    assert.equal(normalizeHref("javascript:alert(1)"), null)
    assert.equal(normalizeHref("data:text/html,<script>1</script>"), null)
    assert.equal(normalizeHref("not a link"), null)
  })

  it("leaves an empty value empty, which clears the link", () => {
    assert.equal(normalizeHref("   "), "")
  })
})

describe("httpStatusTone", () => {
  it("reads a missing response as a failure", () => {
    assert.equal(httpStatusTone(204), "success")
    assert.equal(httpStatusTone(301), "warning")
    assert.equal(httpStatusTone(500), "destructive")
    assert.equal(httpStatusTone(0), "destructive")
  })

  it("labels a missing response in words", () => {
    assert.equal(httpStatusLabel(0), "No response")
    assert.equal(httpStatusLabel(502), "502")
  })
})

describe("messagingLimitLabel", () => {
  it("reads Meta's messaging limit tiers", () => {
    assert.equal(messagingLimitLabel("TIER_250"), "250 per 24 hours")
    assert.equal(messagingLimitLabel("TIER_10K"), "10K per 24 hours")
    assert.equal(messagingLimitLabel("TIER_UNLIMITED"), "Unlimited")
    assert.equal(messagingLimitLabel(undefined), "Unknown")
  })
})

describe("timelineEventLabel", () => {
  it("keeps email wording and spells channel events", async () => {
    const { timelineEventLabel } = await import("./format")
    assert.equal(timelineEventLabel(undefined), "Event")
    assert.equal(timelineEventLabel("delivery_delayed"), "Delayed")
    assert.equal(timelineEventLabel("read"), "Read")
    assert.equal(timelineEventLabel("payment_updated"), "Payment updated")
    assert.equal(
      timelineEventLabel("read_receipt_failed"),
      "Read receipt failed"
    )
    assert.equal(timelineEventLabel("typing_failed"), "Typing failed")
  })
})

describe("campaign outcomes", () => {
  it("labels technical skip words and keeps opt-outs neutral", () => {
    assert.equal(skipReasonLabel("no_channel_identity"), "No channel identity")
    assert.equal(SKIP_REASON_TONE.no_channel_identity, "secondary")
    assert.equal(skipReasonLabel("no_phone"), "No phone number")
    assert.equal(skipReasonLabel("contact_deleted"), "Contact deleted")
    assert.equal(skipReasonLabel("missing_variables"), "Missing variables")
    assert.equal(SKIP_REASON_TONE.marketing_opt_out, "secondary")
    assert.equal(SKIP_REASON_TONE.missing_variables, "warning")
  })
  it("uses the same sentence spelling for Meta and tenant statuses", () => {
    assert.equal(metaTemplateStatusLabel("IN_APPEAL"), "In appeal")
    assert.equal(metaTemplateStatusLabel("LIMIT_EXCEEDED"), "Limit exceeded")
    assert.equal(
      metaTemplateStatusLabel("PENDING_DELETION"),
      "Pending deletion"
    )
    assert.equal(tenantStatusLabel("IN_APPEAL"), "In appeal")
    assert.equal(tenantStatusLabel(), "Unknown")
  })
})

describe("relative time", () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0)
  const at = (seconds: number) => now + seconds * 1000

  it("treats a minute of clock skew as just now", () => {
    assert.equal(formatRelative(at(0), now), "just now")
    assert.equal(formatRelative(at(59), now), "just now")
    assert.equal(formatRelative(at(-59), now), "just now")
  })

  it("steps through minutes, hours and days in both directions", () => {
    assert.equal(formatRelative(at(60), now), "in 1m")
    assert.equal(formatRelative(at(3599), now), "in 59m")
    assert.equal(formatRelative(at(3600), now), "in 1h")
    assert.equal(formatRelative(at(86_399), now), "in 23h")
    assert.equal(formatRelative(at(86_400), now), "in 1d")
    assert.equal(formatRelative(at(364 * 86_400), now), "in 364d")
    assert.equal(formatRelative(at(-60), now), "1m ago")
    assert.equal(formatRelative(at(-3599), now), "59m ago")
    assert.equal(formatRelative(at(-3600), now), "1h ago")
    assert.equal(formatRelative(at(-86_399), now), "23h ago")
    assert.equal(formatRelative(at(-86_400), now), "1d ago")
    assert.equal(formatRelative(at(-364 * 86_400), now), "364d ago")
  })

  it("uses the calendar date once the age reaches a year", () => {
    const future = at(365 * 86_400)
    const past = at(-365 * 86_400)
    assert.equal(formatRelative(future, now), formatDate(future))
    assert.equal(formatRelative(past, now), formatDate(past))
    assert.equal(formatDate(now), format(now, "MMM d, yyyy"))
    assert.equal(formatDateTime(now), format(now, "MMM d, yyyy · HH:mm"))
  })
})

describe("status and permission labels", () => {
  function each<K extends string>(
    labels: Record<K, string>,
    read: (key: K) => string
  ) {
    for (const key of Object.keys(labels) as K[])
      assert.equal(read(key), labels[key])
  }

  it("spells every email, domain, broadcast and export status", () => {
    each<EmailStatus>(
      {
        queued: "Queued",
        scheduled: "Scheduled",
        sent: "Sent",
        delivered: "Delivered",
        delivery_delayed: "Delayed",
        opened: "Opened",
        clicked: "Clicked",
        bounced: "Bounced",
        complained: "Complained",
        failed: "Failed",
        canceled: "Canceled",
        suppressed: "Suppressed",
      },
      emailStatusLabel
    )
    each<DomainStatus>(
      {
        not_started: "Not started",
        pending: "Pending",
        partially_verified: "Partially verified",
        verified: "Verified",
        failed: "Failed",
        temporary_failure: "Temporary failure",
      },
      statusLabel
    )
    each<BroadcastStatus>(
      {
        draft: "Draft",
        scheduled: "Scheduled",
        queued: "Sending",
        sent: "Sent",
        failed: "Failed",
        canceled: "Canceled",
      },
      broadcastStatusLabel
    )
    each<ExportStatus>(
      {
        processing: "Processing",
        ready: "Completed",
        failed: "Failed",
        expired: "Expired",
      },
      exportStatusLabel
    )
    each<SuppressionReason>(
      { bounced: "Hard bounce", complained: "Complaint", manual: "Manual" },
      suppressionReasonLabel
    )
    each<TemplateStatus>(
      { draft: "Draft", published: "Published" },
      templateStatusLabel
    )
    each<AutomationStatus>(
      { enabled: "Enabled", disabled: "Disabled" },
      automationStatusLabel
    )
    each<SkipReason>(
      {
        no_phone: "No phone number",
        no_channel_identity: "No channel identity",
        no_email: "No email address",
        unsubscribed: "Unsubscribed",
        topic_opt_out: "Topic opt-out",
        marketing_opt_out: "Marketing opt-out",
        missing_variables: "Missing variables",
        contact_deleted: "Contact deleted",
        window_closed: "Messaging window closed",
      },
      skipReasonLabel
    )
  })

  it("keeps delivery tones distinct from a message that only left the queue", () => {
    assert.equal(EMAIL_STATUS_TONE.sent, "outline")
    assert.equal(EMAIL_STATUS_TONE.delivered, "success")
    assert.equal(EMAIL_STATUS_TONE.suppressed, "secondary")
    assert.equal(BROADCAST_STATUS_TONE.queued, "warning")
    assert.equal(BROADCAST_STATUS_TONE.draft, "outline")
    assert.equal(CHANNEL_MESSAGE_STATUS_TONE.played, "success")
    assert.equal(CHANNEL_MESSAGE_STATUS_TONE.received, "secondary")
    assert.equal(AUTOMATION_RUN_STATUS_TONE.skipped, "outline")
    assert.equal(AUTOMATION_RUN_STATUS_TONE.cancelled, "secondary")
  })

  it("names permissions, roles, regions and channels in words", () => {
    each<ApiKeyPermission>(
      {
        full_access: "Full access",
        custom: "Custom",
        sending_access: "Sending access",
      },
      permissionLabel
    )
    each<MemberRole>({ admin: "Admin", member: "Member" }, roleLabel)
    for (const region of REGIONS)
      assert.equal(regionLabel(region.value), region.label)
    assert.equal(regionLabel("orbit-1" as Region), "orbit-1")
    for (const channel of CHANNEL_IDS)
      assert.equal(channelLabel(channel), CHANNELS[channel].label)
    assert.equal(
      defaultFromAddress("mail.example.test"),
      "Opensend <hello@mail.example.test>"
    )
    assert.equal(defaultFromAddress(undefined), "Opensend <hello@opensend.cc>")
  })
})

describe("small format helpers", () => {
  it("rounds rates, masks tokens and pluralizes", () => {
    assert.equal(rate(1, 0), 0)
    assert.equal(rate(1, -2), 0)
    assert.equal(rate(1, 4), 25)
    assert.equal(rate(1, 3, 2), 33.33)
    assert.equal(percent(1, 3, 1), "33.3%")
    assert.equal(formatNumber(1000), "1,000")
    assert.equal(maskToken("os", "9f3a"), "os••••9f3a")
    assert.equal(pluralize(1, "contact"), "1 contact")
    assert.equal(pluralize(0, "contact"), "0 contacts")
    assert.equal(pluralize(2, "person", "people"), "2 people")
  })

  it("reads addresses, links and initials", () => {
    assert.equal(isEmail(" Ada@Example.Test "), true)
    assert.equal(isEmail("ada@example"), false)
    assert.equal(isDomainName(" mail.example.test "), true)
    assert.equal(isDomainName("localhost"), false)
    assert.equal(isUrl(" https://example.test/a "), true)
    assert.equal(isUrl("http://example.test"), true)
    assert.equal(isHttpsUrl("http://example.test"), false)
    assert.equal(isUrl("notaurl"), false)
    assert.equal(normalizeEmail(" Ada@Example.Test "), "ada@example.test")
    assert.equal(sentenceCase("limit exceeded"), "Limit exceeded")
    assert.equal(initials("  "), "?")
    assert.equal(initials("ada"), "AD")
    assert.equal(initials("Ada Lovelace"), "AL")
    assert.equal(initials("Ada Grace Hopper"), "AG")
  })
})
