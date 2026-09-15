export const REGIONS = [
  { value: "us-east-1", label: "North Virginia", code: "us-east-1" },
  { value: "eu-west-1", label: "Ireland", code: "eu-west-1" },
  { value: "sa-east-1", label: "São Paulo", code: "sa-east-1" },
  { value: "ap-northeast-1", label: "Tokyo", code: "ap-northeast-1" },
] as const

export type Region = (typeof REGIONS)[number]["value"]

export type DomainStatus =
  "not_started" | "pending" | "verified" | "failed" | "temporary_failure"

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
  "draft" | "scheduled" | "queued" | "sent" | "canceled"

export type TemplateStatus = "draft" | "published"
export type AutomationStatus = "enabled" | "disabled"
export type PropertyType = "string" | "number"
export type SuppressionReason = "bounced" | "complained" | "manual"
export type ExportStatus = "processing" | "ready" | "expired"
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE"

export const WEBHOOK_EVENTS = [
  "email.sent",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.received",
  "email.failed",
  "email.suppressed",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "domain.updated",
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
}

export type Broadcast = {
  id: string
  name: string
  subject: string
  preview: string
  html: string
  status: BroadcastStatus
  segmentId: string | null
  topicId: string | null
  createdAt: number
  scheduledAt: number | null
  sentAt: number | null
  stats: BroadcastStats
}

export type EmailTemplate = {
  id: string
  name: string
  subject: string
  html: string
  status: TemplateStatus
  variables: string[]
  createdAt: number
  updatedAt: number
}

export type Automation = {
  id: string
  name: string
  status: AutomationStatus
  trigger: string
  createdAt: number
  runs: number
}

export type Webhook = {
  id: string
  endpoint: string
  events: WebhookEvent[]
  enabled: boolean
  signingSecretLast4: string
  createdAt: number
}

export type ApiLog = {
  id: string
  method: HttpMethod
  path: string
  status: number
  createdAt: number
  durationMs: number
  emailId: string | null
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
  webhooks: Webhook[]
  logs: ApiLog[]
  exports: ExportJob[]
  settings: Settings
}

export type CreateApiKeyResult = {
  key: ApiKey
  token: string
}

export type CreateWebhookResult = {
  webhook: Webhook
  secret: string
}
