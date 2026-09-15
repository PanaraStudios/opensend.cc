import type {
  ApiKey,
  ApiLog,
  Automation,
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
} from "./types"

const DAY = 86_400_000
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

export function createId(prefix: string): string {
  const entropy = crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  return `${prefix}_${entropy}`
}

export function createToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (byte) =>
    byte.toString(36).padStart(2, "0")
  )
    .join("")
    .slice(0, 32)
  return `os_${body}`
}

export function createWebhookSecret(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return `whsec_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export function tokenParts(token: string): { prefix: string; last4: string } {
  return {
    prefix: token.slice(0, 10),
    last4: token.slice(-4),
  }
}

export function recordsForDomain(
  name: string,
  region: Region,
  status: DomainStatus,
  returnPath = "send"
): DnsRecord[] {
  const returnHost = `${returnPath}.${name}`
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
      name: returnHost,
      value: `feedback-smtp.${region}.amazonses.com`,
      ttl: "Auto",
      priority: 10,
      status,
    },
    {
      id: createId("rec"),
      kind: "SPF",
      type: "TXT",
      name: returnHost,
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
    openTracking: false,
    clickTracking: false,
    tls: "opportunistic",
    customReturnPath: "send",
    receiving: true,
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
    ],
  },
  {
    id: "dom_updates",
    name: "updates.opensend.cc",
    region: "us-east-1",
    status: "partially_verified",
    createdAt: daysAgo(2),
    openTracking: true,
    clickTracking: true,
    tls: "opportunistic",
    customReturnPath: "send",
    receiving: false,
    records: [
      {
        id: "rec_updates_dkim",
        kind: "DKIM",
        type: "CNAME",
        name: "opensend._domainkey.updates.opensend.cc",
        value: "opensend._domainkey.updates.opensend.cc.dkim.opensend.cc",
        ttl: "Auto",
        status: "verified",
      },
      {
        id: "rec_updates_mx",
        kind: "SPF",
        type: "MX",
        name: "send.updates.opensend.cc",
        value: "feedback-smtp.us-east-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "verified",
      },
      {
        id: "rec_updates_spf",
        kind: "SPF",
        type: "TXT",
        name: "send.updates.opensend.cc",
        value: "v=spf1 include:amazonses.com ~all",
        ttl: "Auto",
        status: "pending",
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
    ],
  },
  {
    id: "dom_acme",
    name: "mail.acme.dev",
    region: "eu-west-1",
    status: "verified",
    createdAt: daysAgo(21),
    openTracking: true,
    clickTracking: false,
    tls: "enforced",
    customReturnPath: "bounce",
    receiving: false,
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
        name: "send.mail.acme.dev",
        value: "feedback-smtp.eu-west-1.amazonses.com",
        ttl: "Auto",
        priority: 10,
        status: "verified",
      },
      {
        id: "rec_acme_spf",
        kind: "SPF",
        type: "TXT",
        name: "send.mail.acme.dev",
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
    description: "Staff-only operational mail. Hidden from the preference page.",
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
    createdAt: daysAgo(28),
  },
]

const emails: SentEmail[] = [
  {
    id: "em_welcome_ada",
    from: "Opensend <hello@opensend.cc>",
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
    html: "<p>Reset your password: <a href=\"https://opensend.cc/reset\">this link</a></p>",
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
    from: "Opensend <hello@opensend.cc>",
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
    from: "Opensend <hello@opensend.cc>",
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
    id: "em_scheduled",
    from: "Opensend <hello@opensend.cc>",
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
    scheduledAt: null,
    sentAt: daysAgo(3),
    stats: {
      recipients: 1280,
      delivered: 1244,
      opened: 612,
      clicked: 188,
      bounced: 14,
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
    scheduledAt: null,
    sentAt: null,
    stats: {
      recipients: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
    },
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
    scheduledAt: DEMO_NOW + 2 * DAY,
    sentAt: null,
    stats: {
      recipients: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
    },
  },
]

const templates: EmailTemplate[] = [
  {
    id: "tpl_welcome",
    name: "Welcome",
    subject: "Welcome to {{{PRODUCT}}}",
    html: "<p>Hi {{{FIRST_NAME}}}, welcome to {{{PRODUCT}}}.</p>",
    status: "published",
    variables: ["FIRST_NAME", "PRODUCT"],
    createdAt: daysAgo(28),
    updatedAt: daysAgo(6),
  },
  {
    id: "tpl_reset",
    name: "Password reset",
    subject: "Reset your password",
    html: "<p>Reset link: {{{RESET_URL}}}</p>",
    status: "published",
    variables: ["RESET_URL"],
    createdAt: daysAgo(21),
    updatedAt: daysAgo(21),
  },
  {
    id: "tpl_invoice",
    name: "Invoice",
    subject: "Your {{{MONTH}}} invoice",
    html: "<p>Invoice {{{INVOICE_ID}}} is ready.</p>",
    status: "draft",
    variables: ["MONTH", "INVOICE_ID"],
    createdAt: daysAgo(2),
    updatedAt: hoursAgo(6),
  },
]

const automations: Automation[] = [
  {
    id: "atm_onboard",
    name: "New customer onboarding",
    status: "enabled",
    trigger: "contact.created",
    createdAt: daysAgo(15),
    runs: 42,
  },
  {
    id: "atm_winback",
    name: "Win-back after unsubscribe",
    status: "disabled",
    trigger: "contact.unsubscribed",
    createdAt: daysAgo(9),
    runs: 3,
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
    signingSecretLast4: "a91c",
    createdAt: daysAgo(27),
  },
  {
    id: "wh_staging",
    endpoint: "https://staging.opensend.cc/hooks/email",
    events: ["email.sent", "email.failed"],
    enabled: false,
    signingSecretLast4: "e2b0",
    createdAt: daysAgo(8),
  },
]

const logs: ApiLog[] = [
  {
    id: "log_1",
    method: "POST",
    path: "/emails",
    status: 200,
    createdAt: hoursAgo(5),
    durationMs: 84,
    emailId: "em_welcome_ada",
  },
  {
    id: "log_2",
    method: "POST",
    path: "/emails",
    status: 200,
    createdAt: hoursAgo(18),
    durationMs: 91,
    emailId: "em_receipt_grace",
  },
  {
    id: "log_3",
    method: "GET",
    path: "/emails/em_reset_alan",
    status: 200,
    createdAt: hoursAgo(28),
    durationMs: 22,
    emailId: "em_reset_alan",
  },
  {
    id: "log_4",
    method: "POST",
    path: "/contacts",
    status: 201,
    createdAt: daysAgo(4),
    durationMs: 41,
    emailId: null,
  },
  {
    id: "log_5",
    method: "POST",
    path: "/emails",
    status: 403,
    createdAt: daysAgo(6),
    durationMs: 18,
    emailId: "em_bounce_old",
  },
  {
    id: "log_6",
    method: "GET",
    path: "/domains",
    status: 200,
    createdAt: minutesAgo(40),
    durationMs: 15,
    emailId: null,
  },
]

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
  webhooks,
  logs,
  exports: exportsSeed,
  settings: {
    teamName: "Opensend",
    teamSlug: "opensend",
    billingEmail: "kamal@opensend.cc",
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

export function defaultTopicSubscription(
  topic: Topic
): Contact["topics"][number]["subscription"] {
  return topic.defaultSubscription === "opt_out" ? "subscribed" : "unsubscribed"
}

export function contactTopicStatus(
  contact: Contact,
  topic: Topic
): Contact["topics"][number]["subscription"] {
  const explicit = contact.topics.find((item) => item.topicId === topic.id)
  if (explicit) return explicit.subscription
  return defaultTopicSubscription(topic)
}

export function segmentContactCount(
  contactsList: Contact[],
  segmentId: string
): number {
  return contactsList.filter((contact) =>
    contact.segmentIds.includes(segmentId)
  ).length
}

export function emptyBroadcastStats() {
  return {
    recipients: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
  }
}
