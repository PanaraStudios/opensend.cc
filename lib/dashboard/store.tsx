"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  createId,
  createToken,
  createWebhookSecret,
  defaultTopicSubscription,
  emptyBroadcastStats,
  recordsForDomain,
  SEED_STATE,
  tokenParts,
} from "./data"
import type {
  ApiKeyPermission,
  AutomationStatus,
  Broadcast,
  BroadcastStatus,
  Contact,
  CreateApiKeyResult,
  CreateWebhookResult,
  DashboardState,
  Domain,
  EmailStatus,
  EmailTemplate,
  MemberRole,
  PropertyType,
  Region,
  SentEmail,
  Settings,
  SuppressionReason,
  TemplateStatus,
  TopicDefault,
  TopicSubscription,
  TopicVisibility,
  TlsMode,
  WebhookEvent,
} from "./types"

const STORAGE_KEY = "opensend.dashboard.v2"
const CHANGE_EVENT = "opensend-dashboard"

const SERVER_SNAPSHOT = JSON.stringify(SEED_STATE)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseState(raw: string): DashboardState {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return SEED_STATE
    if (!Array.isArray(parsed.domains) || !Array.isArray(parsed.contacts)) {
      return SEED_STATE
    }
    if (!Array.isArray(parsed.emails) || !Array.isArray(parsed.broadcasts)) {
      return SEED_STATE
    }
    if (!isRecord(parsed.settings)) return SEED_STATE
    return parsed as DashboardState
  } catch {
    return SEED_STATE
  }
}

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? SERVER_SNAPSHOT
  } catch {
    return SERVER_SNAPSHOT
  }
}

function writeState(next: DashboardState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  emitChange()
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange)
  window.addEventListener(CHANGE_EVENT, onStoreChange)
  return () => {
    window.removeEventListener("storage", onStoreChange)
    window.removeEventListener(CHANGE_EVENT, onStoreChange)
  }
}

function mutate(mutator: (current: DashboardState) => DashboardState) {
  writeState(mutator(parseState(readRaw())))
}

export type DashboardStore = {
  state: DashboardState
  addDomain: (input: { name: string; region: Region }) => Domain
  deleteDomain: (id: string) => void
  updateDomain: (
    id: string,
    patch: Partial<
      Pick<
        Domain,
        | "openTracking"
        | "clickTracking"
        | "tls"
        | "customReturnPath"
        | "receiving"
      >
    >
  ) => void
  verifyDomain: (id: string) => void
  addContact: (input: {
    email: string
    firstName: string
    lastName: string
    segmentIds?: string[]
  }) => Contact
  updateContact: (
    id: string,
    patch: Partial<
      Pick<Contact, "firstName" | "lastName" | "unsubscribed" | "properties">
    >
  ) => void
  deleteContact: (id: string) => void
  setContactSegments: (id: string, segmentIds: string[]) => void
  setContactTopic: (
    id: string,
    topicId: string,
    subscription: TopicSubscription
  ) => void
  addSegment: (name: string) => { id: string }
  updateSegment: (id: string, name: string) => void
  deleteSegment: (id: string) => void
  addTopic: (input: {
    name: string
    description: string
    defaultSubscription: TopicDefault
    visibility: TopicVisibility
  }) => { id: string }
  updateTopic: (
    id: string,
    patch: Partial<Pick<import("./types").Topic, "name" | "description" | "visibility">>
  ) => void
  deleteTopic: (id: string) => void
  addProperty: (input: { name: string; key: string; type: PropertyType }) => {
    id: string
  }
  deleteProperty: (id: string) => void
  createApiKey: (input: {
    name: string
    permission: ApiKeyPermission
    domainId: string | null
  }) => CreateApiKeyResult
  updateApiKey: (
    id: string,
    patch: Partial<
      Pick<import("./types").ApiKey, "name" | "permission" | "domainId">
    >
  ) => void
  deleteApiKey: (id: string) => void
  sendEmail: (input: {
    from: string
    to: string
    subject: string
    text: string
    scheduledAt?: number | null
  }) => SentEmail
  cancelEmail: (id: string) => void
  addReceived: (input: {
    from: string
    to: string
    subject: string
    text: string
  }) => void
  addSuppression: (input: { email: string; reason: SuppressionReason }) => void
  removeSuppression: (id: string) => void
  addBroadcast: (input: {
    name: string
    subject: string
    preview: string
    segmentId: string | null
    topicId: string | null
  }) => { id: string }
  updateBroadcast: (
    id: string,
    patch: Partial<
      Pick<Broadcast, "name" | "subject" | "preview" | "html" | "segmentId" | "topicId">
    >
  ) => void
  setBroadcastStatus: (id: string, status: BroadcastStatus) => void
  deleteBroadcast: (id: string) => void
  addTemplate: (input: { name: string; subject: string }) => { id: string }
  updateTemplate: (
    id: string,
    patch: Partial<Pick<EmailTemplate, "name" | "subject" | "html" | "variables">>
  ) => void
  setTemplateStatus: (id: string, status: TemplateStatus) => void
  duplicateTemplate: (id: string) => void
  deleteTemplate: (id: string) => void
  addAutomation: (input: { name: string; trigger: string }) => { id: string }
  setAutomationStatus: (id: string, status: AutomationStatus) => void
  deleteAutomation: (id: string) => void
  createWebhook: (input: {
    endpoint: string
    events: WebhookEvent[]
  }) => CreateWebhookResult
  updateWebhook: (
    id: string,
    patch: Partial<Pick<import("./types").Webhook, "endpoint" | "events" | "enabled">>
  ) => void
  deleteWebhook: (id: string) => void
  rotateWebhookSecret: (id: string) => string
  addExport: (resource: string, rows: number) => void
  updateSettings: (patch: Partial<Settings> | ((current: Settings) => Settings)) => void
  inviteMember: (input: { name: string; email: string; role: MemberRole }) => void
  updateMemberRole: (id: string, role: MemberRole) => void
  removeMember: (id: string) => void
  updateSes: (patch: Partial<Settings["ses"]>) => void
  updateSmtp: (patch: Partial<Settings["smtp"]>) => void
  resetDemo: () => void
}

const DashboardContext = createContext<DashboardStore | null>(null)

export function DashboardProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => SERVER_SNAPSHOT)
  const state = useMemo(() => parseState(raw), [raw])

  const addDomain = useCallback((input: { name: string; region: Region }) => {
    const name = input.name.trim().toLowerCase()
    const domain: Domain = {
      id: createId("dom"),
      name,
      region: input.region,
      status: "not_started",
      createdAt: Date.now(),
      openTracking: false,
      clickTracking: false,
      tls: "opportunistic",
      customReturnPath: "send",
      receiving: false,
      records: recordsForDomain(name, input.region, "not_started"),
    }
    mutate((current) => ({
      ...current,
      domains: [domain, ...current.domains],
    }))
    return domain
  }, [])

  const deleteDomain = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      domains: current.domains.filter((domain) => domain.id !== id),
      apiKeys: current.apiKeys.map((key) =>
        key.domainId === id ? { ...key, domainId: null } : key
      ),
    }))
  }, [])

  const updateDomain = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<
          Domain,
          | "openTracking"
          | "clickTracking"
          | "tls"
          | "customReturnPath"
          | "receiving"
        >
      >
    ) => {
      mutate((current) => ({
        ...current,
        domains: current.domains.map((domain) =>
          domain.id === id ? { ...domain, ...patch } : domain
        ),
      }))
    },
    []
  )

  const verifyDomain = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      domains: current.domains.map((domain) =>
        domain.id === id
          ? {
              ...domain,
              status: "verified",
              records: domain.records.map((record) => ({
                ...record,
                status: "verified" as const,
              })),
            }
          : domain
      ),
    }))
  }, [])

  const addContact = useCallback(
    (input: {
      email: string
      firstName: string
      lastName: string
      segmentIds?: string[]
    }) => {
      const current = parseState(readRaw())
      const contact: Contact = {
        id: createId("con"),
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        createdAt: Date.now(),
        unsubscribed: false,
        segmentIds: input.segmentIds ?? [],
        topics: current.topics.map((topic) => ({
          topicId: topic.id,
          subscription: defaultTopicSubscription(topic),
        })),
        properties: {},
      }
      mutate((prev) => ({
        ...prev,
        contacts: [contact, ...prev.contacts],
      }))
      return contact
    },
    []
  )

  const updateContact = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<Contact, "firstName" | "lastName" | "unsubscribed" | "properties">
      >
    ) => {
      mutate((current) => ({
        ...current,
        contacts: current.contacts.map((contact) =>
          contact.id === id ? { ...contact, ...patch } : contact
        ),
      }))
    },
    []
  )

  const deleteContact = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      contacts: current.contacts.filter((contact) => contact.id !== id),
    }))
  }, [])

  const setContactSegments = useCallback((id: string, segmentIds: string[]) => {
    mutate((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === id ? { ...contact, segmentIds } : contact
      ),
    }))
  }, [])

  const setContactTopic = useCallback(
    (id: string, topicId: string, subscription: TopicSubscription) => {
      mutate((current) => ({
        ...current,
        contacts: current.contacts.map((contact) => {
          if (contact.id !== id) return contact
          const hasTopic = contact.topics.some((item) => item.topicId === topicId)
          return {
            ...contact,
            topics: hasTopic
              ? contact.topics.map((item) =>
                  item.topicId === topicId ? { ...item, subscription } : item
                )
              : [...contact.topics, { topicId, subscription }],
          }
        }),
      }))
    },
    []
  )

  const addSegment = useCallback((name: string) => {
    const id = createId("seg")
    mutate((current) => ({
      ...current,
      segments: [
        { id, name: name.trim(), createdAt: Date.now() },
        ...current.segments,
      ],
    }))
    return { id }
  }, [])

  const updateSegment = useCallback((id: string, name: string) => {
    mutate((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === id ? { ...segment, name: name.trim() } : segment
      ),
    }))
  }, [])

  const deleteSegment = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      segments: current.segments.filter((segment) => segment.id !== id),
      contacts: current.contacts.map((contact) => ({
        ...contact,
        segmentIds: contact.segmentIds.filter((segmentId) => segmentId !== id),
      })),
      broadcasts: current.broadcasts.map((broadcast) =>
        broadcast.segmentId === id ? { ...broadcast, segmentId: null } : broadcast
      ),
    }))
  }, [])

  const addTopic = useCallback(
    (input: {
      name: string
      description: string
      defaultSubscription: TopicDefault
      visibility: TopicVisibility
    }) => {
      const id = createId("top")
      mutate((current) => ({
        ...current,
        topics: [
          {
            id,
            name: input.name.trim(),
            description: input.description.trim(),
            defaultSubscription: input.defaultSubscription,
            visibility: input.visibility,
            createdAt: Date.now(),
          },
          ...current.topics,
        ],
      }))
      return { id }
    },
    []
  )

  const updateTopic = useCallback(
    (
      id: string,
      patch: Partial<Pick<import("./types").Topic, "name" | "description" | "visibility">>
    ) => {
      mutate((current) => ({
        ...current,
        topics: current.topics.map((topic) =>
          topic.id === id ? { ...topic, ...patch } : topic
        ),
      }))
    },
    []
  )

  const deleteTopic = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      topics: current.topics.filter((topic) => topic.id !== id),
      contacts: current.contacts.map((contact) => ({
        ...contact,
        topics: contact.topics.filter((item) => item.topicId !== id),
      })),
      broadcasts: current.broadcasts.map((broadcast) =>
        broadcast.topicId === id ? { ...broadcast, topicId: null } : broadcast
      ),
    }))
  }, [])

  const addProperty = useCallback(
    (input: { name: string; key: string; type: PropertyType }) => {
      const id = createId("prop")
      mutate((current) => ({
        ...current,
        properties: [
          {
            id,
            name: input.name.trim(),
            key: input.key.trim().toLowerCase().replace(/\s+/g, "_"),
            type: input.type,
            createdAt: Date.now(),
          },
          ...current.properties,
        ],
      }))
      return { id }
    },
    []
  )

  const deleteProperty = useCallback((id: string) => {
    mutate((current) => {
      const property = current.properties.find((item) => item.id === id)
      return {
        ...current,
        properties: current.properties.filter((item) => item.id !== id),
        contacts: current.contacts.map((contact) => {
          if (!property) return contact
          const next = { ...contact.properties }
          delete next[property.key]
          return { ...contact, properties: next }
        }),
      }
    })
  }, [])

  const createApiKey = useCallback(
    (input: {
      name: string
      permission: ApiKeyPermission
      domainId: string | null
    }): CreateApiKeyResult => {
      const token = createToken()
      const { prefix, last4 } = tokenParts(token)
      const key = {
        id: createId("key"),
        name: input.name.trim(),
        tokenPrefix: prefix,
        tokenLast4: last4,
        permission: input.permission,
        domainId:
          input.permission === "sending_access" ? input.domainId : null,
        createdAt: Date.now(),
        lastUsedAt: null,
      }
      mutate((current) => ({
        ...current,
        apiKeys: [key, ...current.apiKeys],
      }))
      return { key, token }
    },
    []
  )

  const updateApiKey = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<import("./types").ApiKey, "name" | "permission" | "domainId">
      >
    ) => {
      mutate((current) => ({
        ...current,
        apiKeys: current.apiKeys.map((key) => {
          if (key.id !== id) return key
          const permission = patch.permission ?? key.permission
          return {
            ...key,
            ...patch,
            domainId:
              permission === "sending_access"
                ? (patch.domainId ?? key.domainId)
                : null,
          }
        }),
      }))
    },
    []
  )

  const deleteApiKey = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      apiKeys: current.apiKeys.filter((key) => key.id !== id),
    }))
  }, [])

  const sendEmail = useCallback(
    (input: {
      from: string
      to: string
      subject: string
      text: string
      scheduledAt?: number | null
    }) => {
      const scheduled = input.scheduledAt ?? null
      const status: EmailStatus = scheduled ? "scheduled" : "sent"
      const email: SentEmail = {
        id: createId("em"),
        from: input.from.trim(),
        to: input.to.trim().toLowerCase(),
        subject: input.subject.trim(),
        status,
        createdAt: Date.now(),
        scheduledAt: scheduled,
        html: `<p>${input.text.trim()}</p>`,
        text: input.text.trim(),
        broadcastId: null,
        events: [
          {
            id: createId("evt"),
            type: status,
            at: Date.now(),
          },
        ],
      }
      mutate((current) => ({
        ...current,
        emails: [email, ...current.emails],
        logs: [
          {
            id: createId("log"),
            method: "POST",
            path: "/emails",
            status: 200,
            createdAt: Date.now(),
            durationMs: 64,
            emailId: email.id,
          },
          ...current.logs,
        ],
      }))
      return email
    },
    []
  )

  const cancelEmail = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      emails: current.emails.map((email) =>
        email.id === id && email.status === "scheduled"
          ? {
              ...email,
              status: "canceled",
              events: [
                ...email.events,
                { id: createId("evt"), type: "canceled", at: Date.now() },
              ],
            }
          : email
      ),
    }))
  }, [])

  const addReceived = useCallback(
    (input: { from: string; to: string; subject: string; text: string }) => {
      mutate((current) => ({
        ...current,
        received: [
          {
            id: createId("rcv"),
            from: input.from.trim(),
            to: input.to.trim().toLowerCase(),
            subject: input.subject.trim(),
            createdAt: Date.now(),
            html: `<p>${input.text.trim()}</p>`,
            text: input.text.trim(),
          },
          ...current.received,
        ],
      }))
    },
    []
  )

  const addSuppression = useCallback(
    (input: { email: string; reason: SuppressionReason }) => {
      mutate((current) => ({
        ...current,
        suppressions: [
          {
            id: createId("sup"),
            email: input.email.trim().toLowerCase(),
            reason: input.reason,
            createdAt: Date.now(),
          },
          ...current.suppressions,
        ],
      }))
    },
    []
  )

  const removeSuppression = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      suppressions: current.suppressions.filter((item) => item.id !== id),
    }))
  }, [])

  const addBroadcast = useCallback(
    (input: {
      name: string
      subject: string
      preview: string
      segmentId: string | null
      topicId: string | null
    }) => {
      const id = createId("brd")
      mutate((current) => ({
        ...current,
        broadcasts: [
          {
            id,
            name: input.name.trim(),
            subject: input.subject.trim(),
            preview: input.preview.trim(),
            html: `<p>${input.preview.trim()}</p>`,
            status: "draft",
            segmentId: input.segmentId,
            topicId: input.topicId,
            createdAt: Date.now(),
            scheduledAt: null,
            sentAt: null,
            stats: emptyBroadcastStats(),
          },
          ...current.broadcasts,
        ],
      }))
      return { id }
    },
    []
  )

  const updateBroadcast = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<Broadcast, "name" | "subject" | "preview" | "html" | "segmentId" | "topicId">
      >
    ) => {
      mutate((current) => ({
        ...current,
        broadcasts: current.broadcasts.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      }))
    },
    []
  )

  const setBroadcastStatus = useCallback(
    (id: string, status: BroadcastStatus) => {
      mutate((current) => ({
        ...current,
        broadcasts: current.broadcasts.map((item) => {
          if (item.id !== id) return item
          if (status === "sent") {
            const recipients = item.segmentId
              ? current.contacts.filter((contact) =>
                  contact.segmentIds.includes(item.segmentId!)
                ).length
              : current.contacts.length
            return {
              ...item,
              status,
              sentAt: Date.now(),
              stats: {
                recipients,
                delivered: recipients,
                opened: 0,
                clicked: 0,
                bounced: 0,
              },
            }
          }
          return { ...item, status }
        }),
      }))
    },
    []
  )

  const deleteBroadcast = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      broadcasts: current.broadcasts.filter((item) => item.id !== id),
    }))
  }, [])

  const addTemplate = useCallback((input: { name: string; subject: string }) => {
    const id = createId("tpl")
    mutate((current) => ({
      ...current,
      templates: [
        {
          id,
          name: input.name.trim(),
          subject: input.subject.trim(),
          html: "<p></p>",
          status: "draft",
          variables: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ...current.templates,
      ],
    }))
    return { id }
  }, [])

  const updateTemplate = useCallback(
    (
      id: string,
      patch: Partial<Pick<EmailTemplate, "name" | "subject" | "html" | "variables">>
    ) => {
      mutate((current) => ({
        ...current,
        templates: current.templates.map((item) =>
          item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
        ),
      }))
    },
    []
  )

  const setTemplateStatus = useCallback((id: string, status: TemplateStatus) => {
    mutate((current) => ({
      ...current,
      templates: current.templates.map((item) =>
        item.id === id ? { ...item, status, updatedAt: Date.now() } : item
      ),
    }))
  }, [])

  const duplicateTemplate = useCallback((id: string) => {
    mutate((current) => {
      const source = current.templates.find((item) => item.id === id)
      if (!source) return current
      return {
        ...current,
        templates: [
          {
            ...source,
            id: createId("tpl"),
            name: `${source.name} copy`,
            status: "draft",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ...current.templates,
        ],
      }
    })
  }, [])

  const deleteTemplate = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      templates: current.templates.filter((item) => item.id !== id),
    }))
  }, [])

  const addAutomation = useCallback(
    (input: { name: string; trigger: string }) => {
      const id = createId("atm")
      mutate((current) => ({
        ...current,
        automations: [
          {
            id,
            name: input.name.trim(),
            trigger: input.trigger.trim(),
            status: "disabled",
            createdAt: Date.now(),
            runs: 0,
          },
          ...current.automations,
        ],
      }))
      return { id }
    },
    []
  )

  const setAutomationStatus = useCallback(
    (id: string, status: AutomationStatus) => {
      mutate((current) => ({
        ...current,
        automations: current.automations.map((item) =>
          item.id === id ? { ...item, status } : item
        ),
      }))
    },
    []
  )

  const deleteAutomation = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      automations: current.automations.filter((item) => item.id !== id),
    }))
  }, [])

  const createWebhook = useCallback(
    (input: {
      endpoint: string
      events: WebhookEvent[]
    }): CreateWebhookResult => {
      const secret = createWebhookSecret()
      const webhook = {
        id: createId("wh"),
        endpoint: input.endpoint.trim(),
        events: input.events,
        enabled: true,
        signingSecretLast4: secret.slice(-4),
        createdAt: Date.now(),
      }
      mutate((current) => ({
        ...current,
        webhooks: [webhook, ...current.webhooks],
      }))
      return { webhook, secret }
    },
    []
  )

  const updateWebhook = useCallback(
    (
      id: string,
      patch: Partial<Pick<import("./types").Webhook, "endpoint" | "events" | "enabled">>
    ) => {
      mutate((current) => ({
        ...current,
        webhooks: current.webhooks.map((item) =>
          item.id === id ? { ...item, ...patch } : item
        ),
      }))
    },
    []
  )

  const deleteWebhook = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      webhooks: current.webhooks.filter((item) => item.id !== id),
    }))
  }, [])

  const rotateWebhookSecret = useCallback((id: string) => {
    const secret = createWebhookSecret()
    mutate((current) => ({
      ...current,
      webhooks: current.webhooks.map((item) =>
        item.id === id
          ? { ...item, signingSecretLast4: secret.slice(-4) }
          : item
      ),
    }))
    return secret
  }, [])

  const addExport = useCallback((resource: string, rows: number) => {
    mutate((current) => ({
      ...current,
      exports: [
        {
          id: createId("exp"),
          resource,
          status: "ready",
          createdAt: Date.now(),
          expiresAt: Date.now() + 7 * 86_400_000,
          rows,
        },
        ...current.exports,
      ],
    }))
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<Settings> | ((current: Settings) => Settings)) => {
      mutate((current) => ({
        ...current,
        settings:
          typeof patch === "function"
            ? patch(current.settings)
            : { ...current.settings, ...patch },
      }))
    },
    []
  )

  const inviteMember = useCallback(
    (input: { name: string; email: string; role: MemberRole }) => {
      mutate((current) => ({
        ...current,
        members: [
          ...current.members,
          {
            id: createId("mem"),
            name: input.name.trim(),
            email: input.email.trim().toLowerCase(),
            role: input.role,
            you: false,
            createdAt: Date.now(),
          },
        ],
      }))
    },
    []
  )

  const updateMemberRole = useCallback((id: string, role: MemberRole) => {
    mutate((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === id ? { ...member, role } : member
      ),
    }))
  }, [])

  const removeMember = useCallback((id: string) => {
    mutate((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== id || member.you),
    }))
  }, [])

  const updateSes = useCallback((patch: Partial<Settings["ses"]>) => {
    mutate((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ses: { ...current.settings.ses, ...patch },
      },
    }))
  }, [])

  const updateSmtp = useCallback((patch: Partial<Settings["smtp"]>) => {
    mutate((current) => ({
      ...current,
      settings: {
        ...current.settings,
        smtp: { ...current.settings.smtp, ...patch },
      },
    }))
  }, [])

  const resetDemo = useCallback(() => {
    writeState(SEED_STATE)
  }, [])

  const value = useMemo<DashboardStore>(
    () => ({
      state,
      addDomain,
      deleteDomain,
      updateDomain,
      verifyDomain,
      addContact,
      updateContact,
      deleteContact,
      setContactSegments,
      setContactTopic,
      addSegment,
      updateSegment,
      deleteSegment,
      addTopic,
      updateTopic,
      deleteTopic,
      addProperty,
      deleteProperty,
      createApiKey,
      updateApiKey,
      deleteApiKey,
      sendEmail,
      cancelEmail,
      addReceived,
      addSuppression,
      removeSuppression,
      addBroadcast,
      updateBroadcast,
      setBroadcastStatus,
      deleteBroadcast,
      addTemplate,
      updateTemplate,
      setTemplateStatus,
      duplicateTemplate,
      deleteTemplate,
      addAutomation,
      setAutomationStatus,
      deleteAutomation,
      createWebhook,
      updateWebhook,
      deleteWebhook,
      rotateWebhookSecret,
      addExport,
      updateSettings,
      inviteMember,
      updateMemberRole,
      removeMember,
      updateSes,
      updateSmtp,
      resetDemo,
    }),
    [
      state,
      addDomain,
      deleteDomain,
      updateDomain,
      verifyDomain,
      addContact,
      updateContact,
      deleteContact,
      setContactSegments,
      setContactTopic,
      addSegment,
      updateSegment,
      deleteSegment,
      addTopic,
      updateTopic,
      deleteTopic,
      addProperty,
      deleteProperty,
      createApiKey,
      updateApiKey,
      deleteApiKey,
      sendEmail,
      cancelEmail,
      addReceived,
      addSuppression,
      removeSuppression,
      addBroadcast,
      updateBroadcast,
      setBroadcastStatus,
      deleteBroadcast,
      addTemplate,
      updateTemplate,
      setTemplateStatus,
      duplicateTemplate,
      deleteTemplate,
      addAutomation,
      setAutomationStatus,
      deleteAutomation,
      createWebhook,
      updateWebhook,
      deleteWebhook,
      rotateWebhookSecret,
      addExport,
      updateSettings,
      inviteMember,
      updateMemberRole,
      removeMember,
      updateSes,
      updateSmtp,
      resetDemo,
    ]
  )

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  )
}

export function useDashboard(): DashboardStore {
  const store = useContext(DashboardContext)
  if (!store) {
    throw new Error("useDashboard must be used within DashboardProvider")
  }
  return store
}

export function useDashboardState(): DashboardState {
  return useDashboard().state
}

export type { TlsMode }
