import type { JSONContent } from "@tiptap/core"

export const REGIONS = [
  { value: "us-east-1", label: "North Virginia", code: "us-east-1" },
  { value: "eu-west-1", label: "Ireland", code: "eu-west-1" },
  { value: "sa-east-1", label: "São Paulo", code: "sa-east-1" },
  { value: "ap-northeast-1", label: "Tokyo", code: "ap-northeast-1" },
] as const

export type Region = (typeof REGIONS)[number]["value"]

export type DomainStatus =
  | "not_started"
  | "pending"
  | "partially_verified"
  | "verified"
  | "failed"
  | "temporary_failure"

/** DNS host we detected for a domain. Only some can be configured for you. */
export type DnsProvider =
  "cloudflare" | "route53" | "godaddy" | "namecheap" | "other"

export type DomainEventType =
  "added" | "dns_verified" | "partially_verified" | "verified"

export type DomainEvent = { type: DomainEventType; at: number }

export type RecordKind =
  "DKIM" | "SPF" | "DMARC" | "MX" | "Tracking" | "Receiving"
export type DnsType = "CNAME" | "MX" | "TXT"
export type TlsMode = "opportunistic" | "enforced"
export type TopicDefault = "opt_in" | "opt_out"
export type TopicVisibility = "public" | "private"
export type TopicSubscription = "subscribed" | "unsubscribed"
export type ApiKeyPermission = "full_access" | "sending_access"
export type MemberRole = "admin" | "member"

export type EmailStatus =
  | "queued"
  | "scheduled"
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "failed"
  | "canceled"
  | "suppressed"

export type BroadcastStatus =
  "draft" | "scheduled" | "queued" | "sent" | "failed" | "canceled"

export type TemplateStatus = "draft" | "published"
export type AutomationStatus = "enabled" | "disabled"
export type PropertyType = "string" | "number"
export type SuppressionReason = "bounced" | "complained" | "manual"
export type ExportStatus = "processing" | "ready" | "expired"
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export const WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.received",
  "email.failed",
  "email.scheduled",
  "email.suppressed",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "domain.created",
  "domain.updated",
  "domain.deleted",
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export type DnsRecord = {
  id: string
  kind: RecordKind
  type: DnsType
  name: string
  value: string
  ttl: string
  priority?: number
  status: DomainStatus
}

export type Domain = {
  id: string
  name: string
  region: Region
  status: DomainStatus
  createdAt: number
  openTracking: boolean
  clickTracking: boolean
  tls: TlsMode
  customReturnPath: string
  receiving: boolean
  records: DnsRecord[]
  /* Added after the first release, so persisted workspaces may lack them.
     `normalizeDomain` in ./domains backfills every one on parse. */
  provider?: DnsProvider
  sending?: boolean
  trackingSubdomain?: string
  events?: DomainEvent[]
}

export type Contact = {
  id: string
  email: string
  firstName: string
  lastName: string
  createdAt: number
  unsubscribed: boolean
  segmentIds: string[]
  topics: { topicId: string; subscription: TopicSubscription }[]
  properties: Record<string, string>
}

export type Segment = {
  id: string
  name: string
  createdAt: number
}

export type Topic = {
  id: string
  name: string
  description: string
  defaultSubscription: TopicDefault
  visibility: TopicVisibility
  createdAt: number
}

export type ContactProperty = {
  id: string
  key: string
  name: string
  type: PropertyType
  fallbackValue?: string
  createdAt: number
}

export type ApiKey = {
  id: string
  name: string
  tokenPrefix: string
  tokenLast4: string
  permission: ApiKeyPermission
  domainId: string | null
  createdAt: number
  lastUsedAt: number | null
  /** Member who created the key. Optional: keys stored before this field
      existed simply show no creator. */
  createdBy?: string | null
}

export type TeamMember = {
  id: string
  name: string
  email: string
  role: MemberRole
  you: boolean
  createdAt: number
}

export type EmailEvent = {
  id: string
  type: EmailStatus
  at: number
}

export type SentEmail = {
  id: string
  from: string
  to: string
  subject: string
  status: EmailStatus
  createdAt: number
  scheduledAt: number | null
  html: string
  text: string
  events: EmailEvent[]
  broadcastId: string | null
}

export type ReceivedEmail = {
  id: string
  from: string
  to: string
  subject: string
  createdAt: number
  html: string
  text: string
}

export type Suppression = {
  id: string
  email: string
  reason: SuppressionReason
  createdAt: number
}

export type BroadcastStats = {
  recipients: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  suppressed: number
  unsubscribed: number
  complained: number
}

/** What the email editor works on. A broadcast and a template are both one
    of these, which is how they share the editor. */
export type EmailDraft = {
  id: string
  name: string
  subject: string
  preview: string
  html: string
  /** The editor document `html` was exported from. Absent when the HTML was
      written by hand, and then `html` is the source of truth. */
  content?: JSONContent
  /** The chosen sender. Absent means the workspace's default address. */
  from?: string
  /** Overrides the sending domain's reply address for this send. */
  replyTo?: string
}

export type Broadcast = EmailDraft & {
  status: BroadcastStatus
  segmentId: string | null
  topicId: string | null
  createdAt: number
  updatedAt: number
  scheduledAt: number | null
  sentAt: number | null
  stats: BroadcastStats
}

export type EmailTemplate = EmailDraft & {
  /** The handle the API sends this template by. Unique in the workspace. */
  alias: string
  status: TemplateStatus
  variables: string[]
  createdAt: number
  updatedAt: number
  /** When it was last published, kept through a revert to draft: an alias
      that has been live may still have callers. An edit after this is not
      live yet. */
  publishedAt: number | null
}

export const AUTOMATION_RULE_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "starts_with",
  "ends_with",
  "exists",
  "is_empty",
] as const
export type AutomationRuleOperator = (typeof AUTOMATION_RULE_OPERATORS)[number]

/** One comparison. `field` is scoped: `event.plan`, `contact.email`. */
export type AutomationRule = {
  field: string
  operator: AutomationRuleOperator
  value: string
}

/** One change an "update contact" step makes. `property` is `first_name`,
    `last_name`, `unsubscribed` or a custom property's key; the value is a
    literal, or a reference such as `event.plan`. */
export type AutomationContactField = {
  property: string
  action: "clear" | "change"
  value: string
}

export const AUTOMATION_STEP_TYPES = [
  "condition",
  "delay",
  "wait_for_event",
  "send_email",
  "contact_update",
  "contact_delete",
  "add_to_segment",
] as const
export type AutomationStepType = (typeof AUTOMATION_STEP_TYPES)[number]

/** A step of a workflow. The two that branch hold the steps of each path,
    so a workflow is a tree and a path through it is a run. */
export type AutomationStep = { key: string } & (
  | {
      type: "condition"
      match: "and" | "or"
      rules: AutomationRule[]
      met: AutomationStep[]
      notMet: AutomationStep[]
    }
  | { type: "delay"; duration: string }
  | {
      type: "wait_for_event"
      eventName: string
      timeout: string
      received: AutomationStep[]
      timedOut: AutomationStep[]
    }
  | {
      type: "send_email"
      templateId: string
      /** Empty keeps what the template says. */
      from: string
      replyTo: string
      /** What fills each of the template's variables: a literal, or a
          reference such as `event.first_name`. */
      variables: Record<string, string>
    }
  | { type: "contact_update"; fields: AutomationContactField[] }
  | { type: "contact_delete" }
  | { type: "add_to_segment"; segmentId: string }
)

export type Automation = {
  id: string
  name: string
  status: AutomationStatus
  /** The name of the event that starts a run. */
  trigger: string
  steps: AutomationStep[]
  createdAt: number
}

export const AUTOMATION_EVENT_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
] as const
export type AutomationEventFieldType =
  (typeof AUTOMATION_EVENT_FIELD_TYPES)[number]

/** A custom event an app sends, and the payload it promises. */
export type AutomationEvent = {
  id: string
  name: string
  schema: { key: string; type: AutomationEventFieldType }[]
  createdAt: number
}

export type AutomationRunStatus =
  "running" | "completed" | "failed" | "cancelled"

export type AutomationRunStep = {
  key: string
  type: AutomationStepType | "trigger"
  status: AutomationRunStatus | "skipped"
  startedAt: number
  completedAt: number | null
  output: Record<string, unknown> | null
  error: string | null
}

/** One contact going through a workflow, started by one event. */
export type AutomationRun = {
  id: string
  automationId: string
  status: AutomationRunStatus
  contactEmail: string
  payload: Record<string, unknown>
  startedAt: number
  completedAt: number | null
  steps: AutomationRunStep[]
}

export type Webhook = {
  id: string
  endpoint: string
  events: WebhookEvent[]
  enabled: boolean
  /** Signs every payload. Readable on the webhook's page at any time. */
  signingSecret: string
  createdAt: number
}

/** One attempt to hand an event to an endpoint, and what came back. */
export type WebhookDelivery = {
  id: string
  webhookId: string
  event: WebhookEvent
  /** The endpoint's HTTP status. Anything outside 2xx is a failed delivery. */
  status: number
  /** How many times it has been tried, the first included. */
  attempts: number
  durationMs: number
  createdAt: number
  payload: Record<string, unknown>
  response: string
}

export type LogSource = "api" | "smtp" | "dashboard"

export type ApiLog = {
  id: string
  method: HttpMethod
  path: string
  status: number
  createdAt: number
  durationMs: number
  emailId: string | null
  userAgent: string
  source: LogSource
  apiKeyId: string | null
}

export type ExportJob = {
  id: string
  resource: string
  status: ExportStatus
  createdAt: number
  expiresAt: number
  rows: number
}

export type Team = {
  id: string
  name: string
  slug: string
}

export type Settings = {
  teamName: string
  teamSlug: string
  billingEmail: string
  sso: {
    enabled: boolean
    issuer: string
    clientId: string
  }
  unsubscribe: {
    heading: string
    body: string
    brandName: string
  }
  ses: {
    connected: boolean
    region: Region
    accessKeyLast4: string
    configurationSet: string
  }
  smtp: {
    enabled: boolean
    host: string
    port: 465 | 587
  }
}

export type DashboardState = {
  domains: Domain[]
  contacts: Contact[]
  segments: Segment[]
  topics: Topic[]
  properties: ContactProperty[]
  apiKeys: ApiKey[]
  members: TeamMember[]
  emails: SentEmail[]
  received: ReceivedEmail[]
  suppressions: Suppression[]
  broadcasts: Broadcast[]
  templates: EmailTemplate[]
  automations: Automation[]
  automationEvents: AutomationEvent[]
  automationRuns: AutomationRun[]
  webhooks: Webhook[]
  webhookDeliveries: WebhookDelivery[]
  logs: ApiLog[]
  exports: ExportJob[]
  settings: Settings
}

export type CreateApiKeyResult = {
  key: ApiKey
  token: string
}
