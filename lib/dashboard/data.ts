import type {
  ApiKey,
  Contact,
  DashboardState,
  DnsRecord,
  Domain,
  DomainStatus,
  Region,
  Segment,
  TeamMember,
  Topic,
} from "./types"

const DAY = 86_400_000
/** Fixed clock so seeded demo rows hydrate the same on server and client. */
export const DEMO_NOW = Date.parse("2026-09-13T12:00:00.000Z")

function daysAgo(days: number): number {
  return DEMO_NOW - days * DAY
}

function hoursAgo(hours: number): number {
  return DEMO_NOW - hours * 3_600_000
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

export function tokenParts(token: string): { prefix: string; last4: string } {
  return {
    prefix: token.slice(0, 10),
    last4: token.slice(-4),
  }
}

export function recordsForDomain(
  name: string,
  region: Region,
  status: DomainStatus
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
      name: `send.${name}`,
      value: `feedback-smtp.${region}.amazonses.com`,
      ttl: "Auto",
      priority: 10,
      status,
    },
    {
      id: createId("rec"),
      kind: "SPF",
      type: "TXT",
      name: `send.${name}`,
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
    status: "pending",
    createdAt: daysAgo(2),
    openTracking: true,
    clickTracking: true,
    tls: "opportunistic",
    customReturnPath: "send",
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
    role: "developer",
    you: false,
    createdAt: daysAgo(28),
  },
]

export const SEED_STATE: DashboardState = {
  domains,
  contacts,
  segments,
  topics,
  apiKeys,
  members,
  settings: {
    teamName: "Opensend",
    teamSlug: "opensend",
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
