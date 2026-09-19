import { emptyBroadcastStats } from "./broadcast"
import { DEFAULT_RETURN_PATH } from "./domains"
import { createId } from "./ids"
import { defaultFromAddress } from "./format"
import { DASHBOARD_USER_AGENT, LOG_USER_AGENTS } from "./logs"
import { runStep } from "./automation"
import type {
  Account,
  ApiKey,
  ApiLog,
  Automation,
  AutomationEvent,
  AutomationRun,
  Broadcast,
  Contact,
  ContactProperty,
  DashboardState,
  DnsRecord,
  Domain,
  DomainStatus,
  EmailTemplate,
  ExportJob,
  ReceivedEmail,
  Region,
  Segment,
  SentEmail,
  Suppression,
  TeamMember,
  Topic,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
} from "./types"

export const DAY = 86_400_000
const SEED_FROM = defaultFromAddress(undefined)
/** Fixed clock so seeded demo rows hydrate the same on server and client. */
export const DEMO_NOW = Date.parse("2026-09-13T12:00:00.000Z")

export function daysAgo(days: number): number {
  return DEMO_NOW - days * DAY
}

export function hoursAgo(hours: number): number {
  return DEMO_NOW - hours * 3_600_000
}

export function minutesAgo(minutes: number): number {
  return DEMO_NOW - minutes * 60_000
}

export function recordsForDomain(
  name: string,
  region: Region,
  status: DomainStatus,
  returnPath: string = DEFAULT_RETURN_PATH
): DnsRecord[] {
  return [
    {
      id: createId("rec"),
      kind: "DKIM",
      type: "CNAME",
      name: `opensend._domainkey.${name}`,
      value: `opensend._domainkey.${name}.dkim.opensend.cc`,
      ttl: "Auto",
      status,
    },
    {
      id: createId("rec"),
      kind: "SPF",
      type: "MX",
      name: `${returnPath}.${name}`,
      value: `feedback-smtp.${region}.amazonses.com`,
      ttl: "Auto",
      priority: 10,
      status,
    },
    {
      id: createId("rec"),
      kind: "SPF",
      type: "TXT",
      name: `${returnPath}.${name}`,
      value: "v=spf1 include:amazonses.com ~all",
      ttl: "Auto",
      status,
    },
    {
      id: createId("rec"),
      kind: "DMARC",
      type: "TXT",
      name: `_dmarc.${name}`,
      value: "v=DMARC1; p=none;",
      ttl: "Auto",
      status,
    },
  ]
}

const domains: Domain[] = [
  {
    id: "dom_opensend",
    name: "opensend.cc",
    region: "us-east-1",
    status: "verified",
    createdAt: daysAgo(48),
    provider: "cloudflare",
    sending: true,
    openTracking: false,
    clickTracking: false,
    trackingSubdomain: "",
    tls: "opportunistic",
    customReturnPath: "send",
    receiving: true,
    events: [
      { type: "added", at: daysAgo(48) },
      { type: "dns_verified", at: daysAgo(47) },
      { type: "verified", at: daysAgo(47) },
    ],
    records: [
      {
        id: "rec_opensend_dkim",
        kind: "DKIM",
        type: "CNAME",
        name: "opensend._domainkey.opensend.cc",
        value: "opensend._domainkey.opensend.cc.dkim.opensend.cc",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_opensend_mx",
        kind: "SPF",
        type: "MX",
        name: "send.opensend.cc",
        value: "feedback-smtp.us-east-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "verified",
      },
      {
        id: "rec_opensend_spf",
        kind: "SPF",
        type: "TXT",
        name: "send.opensend.cc",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_opensend_dmarc",
        kind: "DMARC",
        type: "TXT",
        name: "_dmarc.opensend.cc",
        value: "v=DMARC1; p=none;",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_opensend_inbound",
        kind: "Receiving",
        type: "MX",
        name: "opensend.cc",
        value: "inbound-smtp.us-east-1.amazonaws.com",
        ttl: "Auto",
        priority: 10,
        status: "verified",
      },
    ],
  },
  {
    id: "dom_updates",
    name: "updates.opensend.cc",
    region: "us-east-1",
    status: "pending",
    createdAt: daysAgo(2),
    sending: true,
    openTracking: true,
    clickTracking: true,
    trackingSubdomain: "links",
    tls: "opportunistic",
    customReturnPath: "send",
    receiving: false,
    events: [{ type: "added", at: daysAgo(2) }],
    records: [
      {
        id: "rec_updates_dkim",
        kind: "DKIM",
        type: "CNAME",
        name: "opensend._domainkey.updates.opensend.cc",
        value: "opensend._domainkey.updates.opensend.cc.dkim.opensend.cc",
        ttl: "Auto",
        status: "pending",
      },
      {
        id: "rec_updates_mx",
        kind: "SPF",
        type: "MX",
        name: "send.updates.opensend.cc",
        value: "feedback-smtp.us-east-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "not_started",
      },
      {
        id: "rec_updates_spf",
        kind: "SPF",
        type: "TXT",
        name: "send.updates.opensend.cc",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: "Auto",
        status: "not_started",
      },
      {
        id: "rec_updates_dmarc",
        kind: "DMARC",
        type: "TXT",
        name: "_dmarc.updates.opensend.cc",
        value: "v=DMARC1; p=none;",
        ttl: "Auto",
        status: "not_started",
      },
      {
        id: "rec_updates_tracking",
        kind: "Tracking",
        type: "CNAME",
        name: "links.updates.opensend.cc",
        value: "r.us-east-1.awstrack.me",
        ttl: "Auto",
        status: "pending",
      },
    ],
  },
  {
    id: "dom_acme",
    name: "mail.acme.dev",
    region: "eu-west-1",
    status: "verified",
    createdAt: daysAgo(21),
    provider: "route53",
    sending: true,
    openTracking: true,
    clickTracking: false,
    trackingSubdomain: "links",
    tls: "enforced",
    customReturnPath: "bounce",
    receiving: false,
    events: [
      { type: "added", at: daysAgo(21) },
      { type: "dns_verified", at: daysAgo(20) },
      { type: "verified", at: daysAgo(20) },
    ],
    records: [
      {
        id: "rec_acme_dkim",
        kind: "DKIM",
        type: "CNAME",
        name: "opensend._domainkey.mail.acme.dev",
        value: "opensend._domainkey.mail.acme.dev.dkim.opensend.cc",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_acme_mx",
        kind: "SPF",
        type: "MX",
        name: "bounce.mail.acme.dev",
        value: "feedback-smtp.eu-west-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "verified",
      },
      {
        id: "rec_acme_spf",
        kind: "SPF",
        type: "TXT",
        name: "bounce.mail.acme.dev",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_acme_dmarc",
        kind: "DMARC",
        type: "TXT",
        name: "_dmarc.mail.acme.dev",
        value: "v=DMARC1; p=quarantine;",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_acme_tracking",
        kind: "Tracking",
        type: "CNAME",
        name: "links.mail.acme.dev",
        value: "r.eu-west-1.awstrack.me",
        ttl: "Auto",
        status: "verified",
      },
    ],
  },
]

const segments: Segment[] = [
  { id: "seg_customers", name: "Customers", createdAt: daysAgo(40) },
  { id: "seg_beta", name: "Beta testers", createdAt: daysAgo(18) },
  { id: "seg_newsletter", name: "Newsletter", createdAt: daysAgo(12) },
]

const topics: Topic[] = [
  {
    id: "top_product",
    name: "Product updates",
    description: "New features, fixes, and changelog notes.",
    defaultSubscription: "opt_out",
    visibility: "public",
    createdAt: daysAgo(40),
  },
  {
    id: "top_promo",
    name: "Promotions",
    description: "Launches, discounts, and occasional offers.",
    defaultSubscription: "opt_in",
    visibility: "public",
    createdAt: daysAgo(33),
  },
  {
    id: "top_internal",
    name: "Internal",
    description:
      "Staff-only operational mail. Hidden from the preference page.",
    defaultSubscription: "opt_out",
    visibility: "private",
    createdAt: daysAgo(20),
  },
]

export const DEFAULT_CONTACT_PROPERTIES = [
  { key: "email", name: "Email", type: "string" },
  { key: "first_name", name: "First name", type: "string" },
  { key: "last_name", name: "Last name", type: "string" },
  { key: "unsubscribed", name: "Unsubscribed", type: "boolean" },
] as const

const properties: ContactProperty[] = [
  {
    id: "prop_company",
    key: "company",
    name: "Company",
    type: "string",
    fallbackValue: "Acme",
    createdAt: daysAgo(38),
  },
  {
    id: "prop_plan",
    key: "plan",
    name: "Plan",
    type: "string",
    fallbackValue: "Free",
    createdAt: daysAgo(30),
  },
  {
    id: "prop_seats",
    key: "seats",
    name: "Seats",
    type: "number",
    fallbackValue: "1",
    createdAt: daysAgo(16),
  },
]

const contacts: Contact[] = [
  {
    id: "con_ada",
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    createdAt: daysAgo(36),
    unsubscribed: false,
    segmentIds: ["seg_customers", "seg_beta"],
    topics: [
      { topicId: "top_product", subscription: "subscribed" },
      { topicId: "top_promo", subscription: "subscribed" },
      { topicId: "top_internal", subscription: "unsubscribed" },
    ],
    properties: { company: "Analytical Engines", plan: "Pro", seats: "12" },
  },
  {
    id: "con_grace",
    email: "grace@hopper.dev",
    firstName: "Grace",
    lastName: "Hopper",
    createdAt: daysAgo(22),
    unsubscribed: false,
    segmentIds: ["seg_customers"],
    topics: [
      { topicId: "top_product", subscription: "subscribed" },
      { topicId: "top_promo", subscription: "unsubscribed" },
    ],
    properties: { company: "Hopper.dev", plan: "Team", seats: "8" },
  },
  {
    id: "con_alan",
    email: "alan@bletchley.uk",
    firstName: "Alan",
    lastName: "Turing",
    createdAt: daysAgo(14),
    unsubscribed: false,
    segmentIds: ["seg_beta", "seg_newsletter"],
    topics: [{ topicId: "top_product", subscription: "subscribed" }],
    properties: { company: "Bletchley", plan: "Starter", seats: "3" },
  },
  {
    id: "con_margaret",
    email: "margaret@hamilton.space",
    firstName: "Margaret",
    lastName: "Hamilton",
    createdAt: daysAgo(9),
    unsubscribed: false,
    segmentIds: ["seg_newsletter"],
    topics: [
      { topicId: "top_product", subscription: "subscribed" },
      { topicId: "top_promo", subscription: "subscribed" },
    ],
    properties: { company: "Hamilton Space", plan: "Pro", seats: "24" },
  },
  {
    id: "con_katherine",
    email: "katherine@langley.gov",
    firstName: "Katherine",
    lastName: "Johnson",
    createdAt: daysAgo(4),
    unsubscribed: true,
    segmentIds: ["seg_customers"],
    topics: [{ topicId: "top_product", subscription: "unsubscribed" }],
    properties: { company: "Langley", plan: "Free", seats: "1" },
  },
]

const apiKeys: ApiKey[] = [
  {
    id: "key_prod",
    name: "Production",
    tokenPrefix: "os_9f2a1c4e",
    tokenLast4: "k3m8",
    permission: "full_access",
    domainId: null,
    createdAt: daysAgo(40),
    lastUsedAt: hoursAgo(3),
    createdBy: "mem_you",
  },
  {
    id: "key_staging",
    name: "Staging",
    tokenPrefix: "os_b71e0d22",
    tokenLast4: "p4q1",
    permission: "sending_access",
    domainId: "dom_opensend",
    createdAt: daysAgo(19),
    lastUsedAt: hoursAgo(26),
    createdBy: "mem_ada",
  },
  {
    id: "key_ci",
    name: "CI",
    tokenPrefix: "os_c8aa55d0",
    tokenLast4: "n7w2",
    permission: "sending_access",
    domainId: null,
    createdAt: daysAgo(11),
    lastUsedAt: null,
    createdBy: "mem_you",
  },
]

const members: TeamMember[] = [
  {
    id: "mem_you",
    name: "Kamal Panara",
    email: "kamal@opensend.cc",
    role: "admin",
    you: true,
    createdAt: daysAgo(60),
  },
  {
    id: "mem_ada",
    name: "Ada Lovelace",
    email: "ada@opensend.cc",
    role: "member",
    you: false,
    mfa: true,
    createdAt: daysAgo(28),
  },
]

export const SEED_ACCOUNT: Account = {
  providers: [{ provider: "password", connectedAt: daysAgo(60) }],
  mfa: null,
}

const emails: SentEmail[] = [
  {
    id: "em_welcome_ada",
    from: SEED_FROM,
    to: "ada@example.com",
    subject: "Welcome to Opensend",
    status: "delivered",
    createdAt: hoursAgo(5),
    scheduledAt: null,
    html: "<p>Welcome to Opensend. Your domain is verified.</p>",
    text: "Welcome to Opensend. Your domain is verified.",
    broadcastId: null,
    events: [
      { id: "evt_ada_sent", type: "sent", at: hoursAgo(5) },
      { id: "evt_ada_del", type: "delivered", at: hoursAgo(5) + 12_000 },
    ],
  },
  {
    id: "em_receipt_grace",
    from: "Billing <billing@opensend.cc>",
    to: "grace@hopper.dev",
    subject: "Your September invoice",
    status: "opened",
    createdAt: hoursAgo(18),
    scheduledAt: null,
    html: "<p>Invoice #1042 is ready.</p>",
    text: "Invoice #1042 is ready.",
    broadcastId: null,
    events: [
      { id: "evt_grace_sent", type: "sent", at: hoursAgo(18) },
      { id: "evt_grace_del", type: "delivered", at: hoursAgo(18) + 8_000 },
      { id: "evt_grace_open", type: "opened", at: hoursAgo(16) },
    ],
  },
  {
    id: "em_reset_alan",
    from: "Auth <login@opensend.cc>",
    to: "alan@bletchley.uk",
    subject: "Reset your password",
    status: "clicked",
    createdAt: hoursAgo(30),
    scheduledAt: null,
    html: '<p>Reset your password: <a href="https://opensend.cc/reset">this link</a></p>',
    text: "Reset your password: https://opensend.cc/reset",
    broadcastId: null,
    events: [
      { id: "evt_alan_sent", type: "sent", at: hoursAgo(30) },
      { id: "evt_alan_del", type: "delivered", at: hoursAgo(30) + 6_000 },
      { id: "evt_alan_open", type: "opened", at: hoursAgo(29) },
      { id: "evt_alan_click", type: "clicked", at: hoursAgo(29) + 40_000 },
    ],
  },
  {
    id: "em_launch_margaret",
    from: SEED_FROM,
    to: "margaret@hamilton.space",
    subject: "Launch week is live",
    status: "delivered",
    createdAt: daysAgo(3),
    scheduledAt: null,
    html: "<p>Launch week notes for the newsletter segment.</p>",
    text: "Launch week notes for the newsletter segment.",
    broadcastId: "brd_launch",
    events: [
      { id: "evt_meg_sent", type: "sent", at: daysAgo(3) },
      { id: "evt_meg_del", type: "delivered", at: daysAgo(3) + 9_000 },
    ],
  },
  {
    id: "em_bounce_old",
    from: SEED_FROM,
    to: "gone@example.invalid",
    subject: "Product updates",
    status: "bounced",
    createdAt: daysAgo(6),
    scheduledAt: null,
    html: "<p>Could not be delivered.</p>",
    text: "Could not be delivered.",
    broadcastId: "brd_launch",
    events: [
      { id: "evt_bounce_sent", type: "sent", at: daysAgo(6) },
      { id: "evt_bounce_fail", type: "bounced", at: daysAgo(6) + 4_000 },
    ],
  },
  {
    id: "em_launch_complaint",
    from: SEED_FROM,
    to: "noreply@spam.test",
    subject: "Launch week is live",
    status: "complained",
    createdAt: daysAgo(3),
    scheduledAt: null,
    html: "<p>Launch week notes for the newsletter segment.</p>",
    text: "Launch week notes for the newsletter segment.",
    broadcastId: "brd_launch",
    events: [
      { id: "evt_complain_sent", type: "sent", at: daysAgo(3) },
      { id: "evt_complain", type: "complained", at: daysAgo(3) + 20_000 },
    ],
  },
  {
    id: "em_launch_suppressed",
    from: SEED_FROM,
    to: "gone@example.invalid",
    subject: "Launch week is live",
    status: "suppressed",
    createdAt: daysAgo(3),
    scheduledAt: null,
    html: "<p>Launch week notes for the newsletter segment.</p>",
    text: "Launch week notes for the newsletter segment.",
    broadcastId: "brd_launch",
    events: [{ id: "evt_launch_sup", type: "suppressed", at: daysAgo(3) }],
  },
  {
    id: "em_scheduled",
    from: SEED_FROM,
    to: "ada@example.com",
    subject: "Scheduled reminder",
    status: "scheduled",
    createdAt: hoursAgo(1),
    scheduledAt: DEMO_NOW + 6 * 3_600_000,
    html: "<p>This will send later today.</p>",
    text: "This will send later today.",
    broadcastId: null,
    events: [{ id: "evt_sched", type: "scheduled", at: hoursAgo(1) }],
  },
]

const received: ReceivedEmail[] = [
  {
    id: "rcv_support",
    from: "Ada Lovelace <ada@example.com>",
    to: "hello@opensend.cc",
    subject: "Re: Welcome to Opensend",
    createdAt: hoursAgo(3),
    html: "<p>Thanks, domain verified on our side too.</p>",
    text: "Thanks, domain verified on our side too.",
  },
  {
    id: "rcv_inbound",
    from: "Postmaster <mailer-daemon@hopper.dev>",
    to: "inbound@opensend.cc",
    subject: "Automatic reply: out of office",
    createdAt: hoursAgo(11),
    html: "<p>Grace is away until Monday.</p>",
    text: "Grace is away until Monday.",
  },
]

const suppressions: Suppression[] = [
  {
    id: "sup_invalid",
    email: "gone@example.invalid",
    reason: "bounced",
    createdAt: daysAgo(6),
  },
  {
    id: "sup_spam",
    email: "noreply@spam.test",
    reason: "complained",
    createdAt: daysAgo(11),
  },
]

const broadcasts: Broadcast[] = [
  {
    id: "brd_launch",
    name: "Launch week",
    subject: "Launch week is live",
    preview: "What shipped this week, and what is next.",
    html: "<h1>Launch week</h1><p>What shipped this week, and what is next.</p>",
    status: "sent",
    segmentId: "seg_newsletter",
    topicId: "top_product",
    createdAt: daysAgo(4),
    updatedAt: daysAgo(3),
    scheduledAt: null,
    sentAt: daysAgo(3),
    stats: {
      ...emptyBroadcastStats(),
      recipients: 1280,
      delivered: 1244,
      opened: 612,
      clicked: 188,
      // the per-address tabs derive from the seeded emails below: one each
      bounced: 1,
      suppressed: 1,
      complained: 1,
    },
  },
  {
    id: "brd_beta",
    name: "Beta invite",
    subject: "You’re in the next cohort",
    preview: "A short note for testers.",
    html: "<p>You’re in the next cohort.</p>",
    status: "draft",
    segmentId: "seg_beta",
    topicId: "top_product",
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    scheduledAt: null,
    sentAt: null,
    stats: emptyBroadcastStats(),
  },
  {
    id: "brd_promo",
    name: "September promo",
    subject: "One week of Pro, on us",
    preview: "A limited offer for opted-in contacts.",
    html: "<p>One week of Pro, on us.</p>",
    status: "scheduled",
    segmentId: "seg_customers",
    topicId: "top_promo",
    createdAt: hoursAgo(8),
    updatedAt: hoursAgo(8),
    scheduledAt: DEMO_NOW + 2 * DAY,
    sentAt: null,
    stats: emptyBroadcastStats(),
  },
  {
    id: "brd_digest",
    name: "Weekly digest",
    subject: "What we shipped this week",
    preview: "A short recap for the newsletter list.",
    html: "<p>What we shipped this week.</p>",
    status: "queued",
    segmentId: "seg_newsletter",
    topicId: "top_product",
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    scheduledAt: null,
    sentAt: null,
    stats: {
      ...emptyBroadcastStats(),
      recipients: 1280,
    },
  },
  {
    id: "brd_retry",
    name: "Win-back",
    subject: "Still want a seat?",
    preview: "A follow-up that did not send.",
    html: "<p>Still want a seat?</p>",
    status: "failed",
    segmentId: "seg_customers",
    topicId: "top_promo",
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    scheduledAt: null,
    sentAt: null,
    stats: emptyBroadcastStats(),
  },
]

const templates: EmailTemplate[] = [
  {
    id: "tpl_welcome",
    name: "Welcome",
    alias: "welcome",
    subject: "Welcome to {{{PRODUCT}}}",
    preview: "",
    html: "<p>Hi {{{FIRST_NAME}}}, welcome to {{{PRODUCT}}}.</p>",
    status: "published",
    variables: ["FIRST_NAME", "PRODUCT"],
    createdAt: daysAgo(28),
    updatedAt: daysAgo(6),
    publishedAt: daysAgo(6),
  },
  {
    id: "tpl_reset",
    name: "Password reset",
    alias: "password-reset",
    subject: "Reset your password",
    preview: "",
    html: "<p>Reset link: {{{RESET_URL}}}</p>",
    status: "published",
    variables: ["RESET_URL"],
    createdAt: daysAgo(21),
    updatedAt: daysAgo(21),
    publishedAt: daysAgo(21),
  },
  {
    id: "tpl_invoice",
    name: "Invoice",
    alias: "invoice",
    subject: "Your {{{MONTH}}} invoice",
    preview: "",
    html: "<p>Invoice {{{INVOICE_ID}}} is ready.</p>",
    status: "draft",
    variables: ["MONTH", "INVOICE_ID"],
    createdAt: daysAgo(2),
    updatedAt: hoursAgo(6),
    publishedAt: null,
  },
]

const automationEvents: AutomationEvent[] = [
  {
    id: "evt_user_created",
    name: "user.created",
    schema: [
      { key: "plan", type: "string" },
      { key: "seats", type: "number" },
    ],
    createdAt: daysAgo(16),
  },
  {
    id: "evt_onboarding_completed",
    name: "onboarding.completed",
    schema: [],
    createdAt: daysAgo(16),
  },
  {
    id: "evt_subscription_cancelled",
    name: "subscription.cancelled",
    schema: [{ key: "reason", type: "string" }],
    createdAt: daysAgo(9),
  },
]

const automations: Automation[] = [
  {
    id: "atm_onboard",
    name: "New customer onboarding",
    status: "enabled",
    trigger: "user.created",
    createdAt: daysAgo(15),
    steps: [
      {
        key: "send_welcome",
        type: "send_email",
        templateId: "tpl_welcome",
        from: "",
        replyTo: "",
        variables: {},
      },
      {
        key: "wait_for_onboarding",
        type: "wait_for_event",
        eventName: "onboarding.completed",
        timeout: "3 days",
        received: [
          {
            key: "add_to_customers",
            type: "add_to_segment",
            segmentId: "seg_customers",
          },
        ],
        timedOut: [
          {
            key: "is_team_plan",
            type: "condition",
            match: "and",
            rules: [{ field: "event.plan", operator: "eq", value: "team" }],
            met: [
              {
                key: "send_nudge",
                type: "send_email",
                templateId: "tpl_reset",
                from: "",
                replyTo: "",
                variables: {},
              },
            ],
            notMet: [],
          },
        ],
      },
    ],
  },
  {
    id: "atm_winback",
    name: "Win-back after cancelling",
    status: "disabled",
    trigger: "subscription.cancelled",
    createdAt: daysAgo(9),
    steps: [
      { key: "cool_off", type: "delay", duration: "1 week" },
      {
        key: "send_offer",
        type: "send_email",
        templateId: "tpl_invoice",
        from: "",
        replyTo: "",
        variables: {},
      },
    ],
  },
]

const automationRuns: AutomationRun[] = [
  {
    id: "run_1",
    automationId: "atm_onboard",
    status: "running",
    contactEmail: "grace@hopper.dev",
    payload: { plan: "team", seats: 12 },
    startedAt: hoursAgo(5),
    completedAt: null,
    steps: [
      runStep("start", "trigger", "completed", hoursAgo(5), {
        output: { event_name: "user.created" },
      }),
      runStep("send_welcome", "send_email", "completed", hoursAgo(5), {
        output: { to: "grace@hopper.dev" },
      }),
      runStep("wait_for_onboarding", "wait_for_event", "running", hoursAgo(5)),
    ],
  },
  {
    id: "run_2",
    automationId: "atm_onboard",
    status: "completed",
    contactEmail: "ada@example.com",
    payload: { plan: "pro", seats: 3 },
    startedAt: daysAgo(3),
    completedAt: daysAgo(2),
    steps: [
      runStep("start", "trigger", "completed", daysAgo(3), {
        output: { event_name: "user.created" },
      }),
      runStep("send_welcome", "send_email", "completed", daysAgo(3), {
        output: { to: "ada@example.com" },
      }),
      runStep(
        "wait_for_onboarding",
        "wait_for_event",
        "completed",
        daysAgo(2),
        { output: { event_received: true } }
      ),
      runStep("add_to_customers", "add_to_segment", "completed", daysAgo(2)),
    ],
  },
  {
    id: "run_3",
    automationId: "atm_onboard",
    status: "failed",
    contactEmail: "alan@bletchley.uk",
    payload: { plan: "team", seats: 40 },
    startedAt: daysAgo(6),
    completedAt: daysAgo(6),
    steps: [
      runStep("start", "trigger", "completed", daysAgo(6), {
        output: { event_name: "user.created" },
      }),
      runStep("send_welcome", "send_email", "failed", daysAgo(6), {
        error: "The sender's domain is not verified",
      }),
    ],
  },
  {
    id: "run_4",
    automationId: "atm_onboard",
    status: "cancelled",
    contactEmail: "margaret@hamilton.space",
    payload: { plan: "free", seats: 1 },
    startedAt: daysAgo(8),
    completedAt: daysAgo(7),
    steps: [
      runStep("start", "trigger", "completed", daysAgo(8), {
        output: { event_name: "user.created" },
      }),
      runStep("send_welcome", "send_email", "completed", daysAgo(8), {
        output: { to: "margaret@hamilton.space" },
      }),
      runStep("wait_for_onboarding", "wait_for_event", "cancelled", daysAgo(7)),
    ],
  },
]

const webhooks: Webhook[] = [
  {
    id: "wh_prod",
    endpoint: "https://api.opensend.cc/hooks/resend",
    events: [
      "email.delivered",
      "email.bounced",
      "email.complained",
      "email.received",
    ],
    enabled: true,
    signingSecret: "whsec_3f9a1c7e5b2d48f0a6c4e8b1d7f2a91c",
    createdAt: daysAgo(27),
  },
  {
    id: "wh_staging",
    endpoint: "https://staging.opensend.cc/hooks/email",
    events: ["email.sent", "email.failed"],
    enabled: false,
    signingSecret: "whsec_9d2b6f4a1c8e47b3a5d0f7c2b8e4e2b0",
    createdAt: daysAgo(8),
  },
]

function emailEventPayload(type: WebhookEvent, at: number) {
  return {
    type,
    created_at: new Date(at).toISOString(),
    data: {
      email_id: "em_launch_ada",
      from: "Opensend <hello@opensend.cc>",
      to: ["ada@example.com"],
      subject: "Launch week is live",
    },
  }
}

const webhookDeliveries: WebhookDelivery[] = (
  [
    ["whd_1", "wh_prod", "email.delivered", 200, 1, 212, minutesAgo(12)],
    ["whd_2", "wh_prod", "email.bounced", 200, 1, 187, minutesAgo(95)],
    ["whd_3", "wh_prod", "email.delivered", 500, 3, 3021, hoursAgo(5)],
    ["whd_4", "wh_prod", "email.received", 200, 1, 240, hoursAgo(9)],
    ["whd_5", "wh_prod", "email.complained", 200, 2, 198, daysAgo(1)],
    ["whd_6", "wh_prod", "email.delivered", 200, 1, 176, daysAgo(2)],
    ["whd_7", "wh_staging", "email.failed", 404, 5, 96, daysAgo(8)],
  ] as const
).map(([id, webhookId, event, status, attempts, durationMs, createdAt]) => ({
  id,
  webhookId,
  event,
  status,
  attempts,
  durationMs,
  createdAt,
  payload: emailEventPayload(event, createdAt),
  response:
    status === 200
      ? "OK"
      : status === 404
        ? "Not Found"
        : "Internal Server Error",
}))

const NODE_SDK = LOG_USER_AGENTS[0]

const recentLogs: ApiLog[] = [
  {
    id: "log_6",
    method: "GET",
    path: "/domains",
    status: 200,
    createdAt: minutesAgo(40),
    durationMs: 15,
    emailId: null,
    userAgent: "curl/8.7.1",
    source: "api",
    apiKeyId: "key_staging",
  },
  {
    id: "log_1",
    method: "POST",
    path: "/emails",
    status: 200,
    createdAt: hoursAgo(5),
    durationMs: 84,
    emailId: "em_welcome_ada",
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_prod",
  },
  {
    id: "log_2",
    method: "POST",
    path: "/emails",
    status: 200,
    createdAt: hoursAgo(18),
    durationMs: 91,
    emailId: "em_receipt_grace",
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_prod",
  },
  {
    id: "log_3",
    method: "GET",
    path: "/emails/em_reset_alan",
    status: 200,
    createdAt: hoursAgo(28),
    durationMs: 22,
    emailId: "em_reset_alan",
    userAgent: DASHBOARD_USER_AGENT,
    source: "dashboard",
    apiKeyId: null,
  },
  {
    id: "log_4",
    method: "POST",
    path: "/contacts",
    status: 201,
    createdAt: daysAgo(4),
    durationMs: 41,
    emailId: null,
    userAgent: "opensend-python:0.9.2",
    source: "api",
    apiKeyId: "key_prod",
  },
  {
    id: "log_5",
    method: "POST",
    path: "/emails",
    status: 403,
    createdAt: daysAgo(6),
    durationMs: 18,
    emailId: "em_bounce_old",
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_ci",
  },
]

/* Older traffic, generated so the list has enough rows to page through. */
const TRAFFIC_SHAPES: Pick<
  ApiLog,
  "method" | "path" | "status" | "userAgent" | "source" | "apiKeyId"
>[] = [
  {
    method: "POST",
    path: "/emails",
    status: 200,
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_prod",
  },
  {
    method: "POST",
    path: "/emails",
    status: 200,
    userAgent: "Opensend SMTP",
    source: "smtp",
    apiKeyId: "key_prod",
  },
  {
    method: "GET",
    path: "/contacts",
    status: 200,
    userAgent: "opensend-python:0.9.2",
    source: "api",
    apiKeyId: "key_staging",
  },
  {
    method: "POST",
    path: "/emails",
    status: 422,
    userAgent: "curl/8.7.1",
    source: "api",
    apiKeyId: "key_ci",
  },
  {
    method: "PATCH",
    path: "/contacts/con_ada",
    status: 200,
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_prod",
  },
  {
    method: "POST",
    path: "/emails",
    status: 429,
    userAgent: NODE_SDK,
    source: "api",
    apiKeyId: "key_ci",
  },
  {
    method: "DELETE",
    path: "/webhooks/wh_old",
    status: 200,
    userAgent: DASHBOARD_USER_AGENT,
    source: "dashboard",
    apiKeyId: null,
  },
]

const olderLogs: ApiLog[] = Array.from({ length: 53 }, (_, index) => ({
  ...TRAFFIC_SHAPES[index % TRAFFIC_SHAPES.length],
  id: `log_seed_${index + 1}`,
  createdAt: daysAgo(7) - index * 11 * 3_600_000,
  durationMs: 14 + ((index * 37) % 90),
  emailId: null,
}))

const logs: ApiLog[] = [...recentLogs, ...olderLogs]

const exportsSeed: ExportJob[] = [
  {
    id: "exp_contacts",
    resource: "Contacts",
    status: "ready",
    createdAt: daysAgo(2),
    expiresAt: daysAgo(2) + 7 * DAY,
    rows: 5,
  },
  {
    id: "exp_emails",
    resource: "Emails",
    status: "expired",
    createdAt: daysAgo(12),
    expiresAt: daysAgo(5),
    rows: 48,
  },
]

export const SEED_STATE: DashboardState = {
  domains,
  contacts,
  segments,
  topics,
  properties,
  apiKeys,
  members,
  emails,
  received,
  suppressions,
  broadcasts,
  templates,
  automations,
  automationEvents,
  automationRuns,
  webhooks,
  webhookDeliveries,
  logs,
  exports: exportsSeed,
  settings: {
    teamName: "Opensend",
    teamSlug: "opensend",
    sso: {
      enabled: false,
      issuer: "",
      clientId: "",
    },
    unsubscribe: {
      heading: "Manage your email preferences",
      body: "Choose the topics you still want from this workspace.",
      brandName: "Opensend",
    },
    ses: {
      connected: true,
      region: "us-east-1",
      accessKeyLast4: "4K2P",
      configurationSet: "opensend-prod",
    },
    smtp: {
      enabled: true,
      host: "smtp.opensend.cc",
      port: 465,
    },
  },
}
