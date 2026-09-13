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
  | "verified"
  | "failed"
  | "temporary_failure"

export type RecordKind = "DKIM" | "SPF" | "DMARC"
export type DnsType = "CNAME" | "MX" | "TXT"
export type TlsMode = "opportunistic" | "enforced"
export type TopicDefault = "opt_in" | "opt_out"
export type TopicVisibility = "public" | "private"
export type TopicSubscription = "subscribed" | "unsubscribed"
export type ApiKeyPermission = "full_access" | "sending_access"
export type MemberRole = "admin" | "developer" | "viewer"

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

export type Settings = {
  teamName: string
  teamSlug: string
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
  apiKeys: ApiKey[]
  members: TeamMember[]
  settings: Settings
}

export type CreateApiKeyResult = {
  key: ApiKey
  token: string
}
