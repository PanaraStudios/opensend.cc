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
  defaultTopicSubscription,
  recordsForDomain,
  SEED_STATE,
  tokenParts,
} from "./data"
import type {
  ApiKeyPermission,
  Contact,
  CreateApiKeyResult,
  DashboardState,
  Domain,
  MemberRole,
  Region,
  Settings,
  TopicDefault,
  TopicSubscription,
  TopicVisibility,
  TlsMode,
} from "./types"

const STORAGE_KEY = "opensend.dashboard.v1"
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
    if (!Array.isArray(parsed.segments) || !Array.isArray(parsed.topics)) {
      return SEED_STATE
    }
    if (!Array.isArray(parsed.apiKeys) || !Array.isArray(parsed.members)) {
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

function update(mutator: (current: DashboardState) => DashboardState) {
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
        "openTracking" | "clickTracking" | "tls" | "customReturnPath"
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
    patch: Partial<Pick<Contact, "firstName" | "lastName" | "unsubscribed">>
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
      records: recordsForDomain(name, input.region, "not_started"),
    }
    update((current) => ({
      ...current,
      domains: [domain, ...current.domains],
    }))
    return domain
  }, [])

  const deleteDomain = useCallback((id: string) => {
    update((current) => ({
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
        Pick<Domain, "openTracking" | "clickTracking" | "tls" | "customReturnPath">
      >
    ) => {
      update((current) => ({
        ...current,
        domains: current.domains.map((domain) =>
          domain.id === id ? { ...domain, ...patch } : domain
        ),
      }))
    },
    []
  )

  const verifyDomain = useCallback((id: string) => {
    update((current) => ({
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
      const contact: Contact = {
        id: createId("con"),
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        createdAt: Date.now(),
        unsubscribed: false,
        segmentIds: input.segmentIds ?? [],
        topics: parseState(readRaw()).topics.map((topic) => ({
          topicId: topic.id,
          subscription: defaultTopicSubscription(topic),
        })),
      }
      update((current) => ({
        ...current,
        contacts: [contact, ...current.contacts],
      }))
      return contact
    },
    []
  )

  const updateContact = useCallback(
    (
      id: string,
      patch: Partial<Pick<Contact, "firstName" | "lastName" | "unsubscribed">>
    ) => {
      update((current) => ({
        ...current,
        contacts: current.contacts.map((contact) =>
          contact.id === id ? { ...contact, ...patch } : contact
        ),
      }))
    },
    []
  )

  const deleteContact = useCallback((id: string) => {
    update((current) => ({
      ...current,
      contacts: current.contacts.filter((contact) => contact.id !== id),
    }))
  }, [])

  const setContactSegments = useCallback((id: string, segmentIds: string[]) => {
    update((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === id ? { ...contact, segmentIds } : contact
      ),
    }))
  }, [])

  const setContactTopic = useCallback(
    (id: string, topicId: string, subscription: TopicSubscription) => {
      update((current) => ({
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
    update((current) => ({
      ...current,
      segments: [
        { id, name: name.trim(), createdAt: Date.now() },
        ...current.segments,
      ],
    }))
    return { id }
  }, [])

  const updateSegment = useCallback((id: string, name: string) => {
    update((current) => ({
      ...current,
      segments: current.segments.map((segment) =>
        segment.id === id ? { ...segment, name: name.trim() } : segment
      ),
    }))
  }, [])

  const deleteSegment = useCallback((id: string) => {
    update((current) => ({
      ...current,
      segments: current.segments.filter((segment) => segment.id !== id),
      contacts: current.contacts.map((contact) => ({
        ...contact,
        segmentIds: contact.segmentIds.filter((segmentId) => segmentId !== id),
      })),
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
      update((current) => ({
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
      update((current) => ({
        ...current,
        topics: current.topics.map((topic) =>
          topic.id === id ? { ...topic, ...patch } : topic
        ),
      }))
    },
    []
  )

  const deleteTopic = useCallback((id: string) => {
    update((current) => ({
      ...current,
      topics: current.topics.filter((topic) => topic.id !== id),
      contacts: current.contacts.map((contact) => ({
        ...contact,
        topics: contact.topics.filter((item) => item.topicId !== id),
      })),
    }))
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
      update((current) => ({
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
      update((current) => ({
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
    update((current) => ({
      ...current,
      apiKeys: current.apiKeys.filter((key) => key.id !== id),
    }))
  }, [])

  const updateSettings = useCallback(
    (patch: Partial<Settings> | ((current: Settings) => Settings)) => {
      update((current) => ({
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
      update((current) => ({
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
    update((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === id ? { ...member, role } : member
      ),
    }))
  }, [])

  const removeMember = useCallback((id: string) => {
    update((current) => ({
      ...current,
      members: current.members.filter((member) => member.id !== id || member.you),
    }))
  }, [])

  const updateSes = useCallback((patch: Partial<Settings["ses"]>) => {
    update((current) => ({
      ...current,
      settings: {
        ...current.settings,
        ses: { ...current.settings.ses, ...patch },
      },
    }))
  }, [])

  const updateSmtp = useCallback((patch: Partial<Settings["smtp"]>) => {
    update((current) => ({
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
      createApiKey,
      updateApiKey,
      deleteApiKey,
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
      createApiKey,
      updateApiKey,
      deleteApiKey,
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
