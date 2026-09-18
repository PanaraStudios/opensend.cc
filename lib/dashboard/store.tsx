"use client"

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  broadcastFrom,
  broadcastRecipients,
  emptyBroadcastStats,
  transitionBroadcast,
} from "./broadcast"
import { defaultTopicSubscription, normalizePropertyKey } from "./contacts"
import { emptyEmailDocument } from "./email-document"
import { recordsForDomain } from "./data"
import {
  DEFAULT_RETURN_PATH,
  normalizeDomainName,
  reconcileDomain,
  verifyDomainRecords,
} from "./domains"
import { createId, createToken, createWebhookSecret, tokenParts } from "./ids"
import { DASHBOARD_USER_AGENT } from "./logs"
import {
  activeWorkspace,
  createTeamInRoot,
  listTeams,
  parseRoot,
  seedRoot,
  serializeRoot,
  switchTeamInRoot,
  type DashboardRoot,
} from "./teams"
import type {
  ApiKey,
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
  Team,
  TemplateStatus,
  Topic,
  TopicDefault,
  TopicSubscription,
  TopicVisibility,
  Webhook,
  WebhookEvent,
} from "./types"

const STORAGE_KEY = "opensend.dashboard.v3"
const LEGACY_STORAGE_KEY = "opensend.dashboard.v2"
const CHANGE_EVENT = "opensend-dashboard"

const SERVER_SNAPSHOT = serializeRoot(seedRoot())

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function readRaw(): string {
  try {
    const current = localStorage.getItem(STORAGE_KEY)
    if (current) return current
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacy) {
      const migrated = serializeRoot(parseRoot(legacy))
      localStorage.setItem(STORAGE_KEY, migrated)
      return migrated
    }
    return SERVER_SNAPSHOT
  } catch {
    return SERVER_SNAPSHOT
  }
}

/* One parse per distinct snapshot: the provider and every mutation share it,
   so a keystroke that writes the store does not re-parse the whole root. */
let cachedRaw: string | null = null
let cachedRoot: DashboardRoot | null = null

function rootFromRaw(raw: string): DashboardRoot {
  if (raw !== cachedRaw || !cachedRoot) {
    cachedRaw = raw
    cachedRoot = parseRoot(raw)
  }
  return cachedRoot
}

function writeRoot(next: DashboardRoot) {
  const raw = serializeRoot(next)
  cachedRaw = raw
  cachedRoot = next
  localStorage.setItem(STORAGE_KEY, raw)
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

function mutateRoot(mutator: (current: DashboardRoot) => DashboardRoot) {
  writeRoot(mutator(rootFromRaw(readRaw())))
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

function mutate(mutator: (current: DashboardState) => DashboardState) {
  mutateRoot((root) => {
    const current = root.workspaces[root.activeTeamId]
    if (!current) return root
    return {
      ...root,
      workspaces: {
        ...root.workspaces,
        [root.activeTeamId]: mutator(current),
      },
    }
  })
}

function addDomain(input: {
  name: string
  region: Region
  customReturnPath?: string
}) {
  const name = normalizeDomainName(input.name)
  const returnPath = (input.customReturnPath || DEFAULT_RETURN_PATH)
    .trim()
    .toLowerCase()
  const now = Date.now()
  const domain: Domain = reconcileDomain(
    {
      id: createId("dom"),
      name,
      region: input.region,
      status: "not_started",
      createdAt: now,
      sending: true,
      openTracking: false,
      clickTracking: false,
      trackingSubdomain: "",
      tls: "opportunistic",
      customReturnPath: returnPath,
      receiving: false,
      events: [],
      records: recordsForDomain(name, input.region, "not_started", returnPath),
    },
    now
  )
  mutate((current) => ({
    ...current,
    domains: [domain, ...current.domains],
  }))
  return domain
}

function deleteDomain(id: string) {
  mutate((current) => ({
    ...current,
    domains: current.domains.filter((domain) => domain.id !== id),
    apiKeys: current.apiKeys.map((key) =>
      key.domainId === id ? { ...key, domainId: null } : key
    ),
  }))
}

/* Every field here can change the records a domain needs, so the patch runs
   through `reconcileDomain`: it syncs the record list, re-derives the status,
   and stamps any milestone the change just reached. */
function updateDomain(
  id: string,
  patch: Partial<
    Pick<
      Domain,
      | "sending"
      | "openTracking"
      | "clickTracking"
      | "trackingSubdomain"
      | "tls"
      | "customReturnPath"
      | "receiving"
      | "provider"
    >
  >
) {
  const now = Date.now()
  mutate((current) => ({
    ...current,
    domains: current.domains.map((domain) =>
      domain.id === id ? reconcileDomain({ ...domain, ...patch }, now) : domain
    ),
  }))
}

function verifyDomain(id: string) {
  const now = Date.now()
  mutate((current) => ({
    ...current,
    domains: current.domains.map((domain) =>
      domain.id === id ? verifyDomainRecords(domain, now) : domain
    ),
  }))
}

type ContactInput = {
  email: string
  firstName?: string
  lastName?: string
  unsubscribed?: boolean
  properties?: Record<string, string>
  segmentIds?: string[]
}

function buildContact(
  current: DashboardState,
  input: ContactInput,
  email: string
): Contact {
  return {
    id: createId("con"),
    email,
    firstName: input.firstName?.trim() ?? "",
    lastName: input.lastName?.trim() ?? "",
    createdAt: Date.now(),
    unsubscribed: input.unsubscribed ?? false,
    segmentIds: uniqueIds(input.segmentIds ?? []),
    topics: current.topics.map((topic) => ({
      topicId: topic.id,
      subscription: defaultTopicSubscription(topic),
    })),
    properties: input.properties ?? {},
  }
}

function mergeContact(existing: Contact, input: ContactInput): Contact {
  return {
    ...existing,
    firstName: input.firstName?.trim() || existing.firstName,
    lastName: input.lastName?.trim() || existing.lastName,
    unsubscribed: input.unsubscribed ?? existing.unsubscribed,
    segmentIds: uniqueIds([
      ...existing.segmentIds,
      ...(input.segmentIds ?? []),
    ]),
    properties: { ...existing.properties, ...(input.properties ?? {}) },
  }
}

function addContact(input: ContactInput) {
  const current = activeWorkspace(rootFromRaw(readRaw()))
  const contact = buildContact(current, input, input.email.trim().toLowerCase())
  mutate((prev) => ({ ...prev, contacts: [contact, ...prev.contacts] }))
  return contact
}

/** Creates or merges by email. Rows that repeat an address within the same
    batch merge into the row that introduced it. */
function upsertContacts(inputs: ContactInput[]) {
  let created = 0
  let updated = 0
  mutate((current) => {
    const contacts = [...current.contacts]
    const indexByEmail = new Map(
      contacts.map((contact, index) => [contact.email, index])
    )
    const added = new Map<string, Contact>()
    for (const input of inputs) {
      const email = input.email.trim().toLowerCase()
      if (!email) continue
      const index = indexByEmail.get(email)
      if (index !== undefined) {
        contacts[index] = mergeContact(contacts[index], input)
        updated += 1
        continue
      }
      const pending = added.get(email)
      if (pending) {
        added.set(email, mergeContact(pending, input))
        updated += 1
        continue
      }
      added.set(email, buildContact(current, input, email))
      created += 1
    }
    return {
      ...current,
      contacts: [...[...added.values()].reverse(), ...contacts],
    }
  })
  return { created, updated }
}

function updateContact(
  id: string,
  patch: Partial<
    Pick<Contact, "firstName" | "lastName" | "unsubscribed" | "properties">
  >
) {
  mutate((current) => ({
    ...current,
    contacts: current.contacts.map((contact) =>
      contact.id === id ? { ...contact, ...patch } : contact
    ),
  }))
}

function deleteContact(id: string) {
  mutate((current) => ({
    ...current,
    contacts: current.contacts.filter((contact) => contact.id !== id),
  }))
}

function deleteContacts(ids: string[]) {
  const remove = new Set(ids)
  mutate((current) => ({
    ...current,
    contacts: current.contacts.filter((contact) => !remove.has(contact.id)),
  }))
}

function setContactSegments(id: string, segmentIds: string[]) {
  mutate((current) => ({
    ...current,
    contacts: current.contacts.map((contact) =>
      contact.id === id ? { ...contact, segmentIds } : contact
    ),
  }))
}

function addContactsToSegments(ids: string[], segmentIds: string[]) {
  const selected = new Set(ids)
  mutate((current) => ({
    ...current,
    contacts: current.contacts.map((contact) =>
      selected.has(contact.id)
        ? {
            ...contact,
            segmentIds: uniqueIds([...contact.segmentIds, ...segmentIds]),
          }
        : contact
    ),
  }))
}

function withTopic(
  contact: Contact,
  topicId: string,
  subscription: TopicSubscription
): Contact {
  const hasTopic = contact.topics.some((item) => item.topicId === topicId)
  return {
    ...contact,
    topics: hasTopic
      ? contact.topics.map((item) =>
          item.topicId === topicId ? { ...item, subscription } : item
        )
      : [...contact.topics, { topicId, subscription }],
  }
}

function setContactTopic(
  id: string,
  topicId: string,
  subscription: TopicSubscription
) {
  mutate((current) => ({
    ...current,
    contacts: current.contacts.map((contact) =>
      contact.id === id ? withTopic(contact, topicId, subscription) : contact
    ),
  }))
}

function subscribeContactsToTopics(ids: string[], topicIds: string[]) {
  const selected = new Set(ids)
  mutate((current) => ({
    ...current,
    contacts: current.contacts.map((contact) =>
      selected.has(contact.id)
        ? topicIds.reduce(
            (next, topicId) => withTopic(next, topicId, "subscribed"),
            contact
          )
        : contact
    ),
  }))
}

function addSegment(name: string) {
  const id = createId("seg")
  mutate((current) => ({
    ...current,
    segments: [
      { id, name: name.trim(), createdAt: Date.now() },
      ...current.segments,
    ],
  }))
  return { id }
}

function updateSegment(id: string, name: string) {
  mutate((current) => ({
    ...current,
    segments: current.segments.map((segment) =>
      segment.id === id ? { ...segment, name: name.trim() } : segment
    ),
  }))
}

function deleteSegment(id: string) {
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
}

function addTopic(input: {
  name: string
  description: string
  defaultSubscription: TopicDefault
  visibility: TopicVisibility
}) {
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
}

function updateTopic(
  id: string,
  patch: Partial<Pick<Topic, "name" | "description" | "visibility">>
) {
  mutate((current) => ({
    ...current,
    topics: current.topics.map((topic) =>
      topic.id === id ? { ...topic, ...patch } : topic
    ),
  }))
}

function deleteTopic(id: string) {
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
}

function addProperty(input: {
  name: string
  key: string
  type: PropertyType
  fallbackValue?: string
}) {
  const id = createId("prop")
  const fallbackValue = input.fallbackValue?.trim()
  mutate((current) => ({
    ...current,
    properties: [
      {
        id,
        name: input.name.trim(),
        key: normalizePropertyKey(input.key),
        type: input.type,
        fallbackValue: fallbackValue || undefined,
        createdAt: Date.now(),
      },
      ...current.properties,
    ],
  }))
  return { id }
}

function deleteProperty(id: string) {
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
}

function createApiKey(input: {
  name: string
  permission: ApiKeyPermission
  domainId: string | null
}): CreateApiKeyResult {
  const token = createToken()
  const { prefix, last4 } = tokenParts(token)
  const you = activeWorkspace(rootFromRaw(readRaw())).members.find(
    (member) => member.you
  )
  const key = {
    id: createId("key"),
    name: input.name.trim(),
    tokenPrefix: prefix,
    tokenLast4: last4,
    permission: input.permission,
    domainId: input.permission === "sending_access" ? input.domainId : null,
    createdAt: Date.now(),
    lastUsedAt: null,
    createdBy: you?.id ?? null,
  }
  mutate((current) => ({
    ...current,
    apiKeys: [key, ...current.apiKeys],
  }))
  return { key, token }
}

function updateApiKey(
  id: string,
  patch: Partial<Pick<ApiKey, "name" | "permission" | "domainId">>
) {
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
}

function deleteApiKey(id: string) {
  mutate((current) => ({
    ...current,
    apiKeys: current.apiKeys.filter((key) => key.id !== id),
  }))
}

function sendEmail(input: {
  from: string
  to: string
  subject: string
  text: string
  /** Rendered body. Defaults to the text wrapped in a paragraph. */
  html?: string
  scheduledAt?: number | null
}) {
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
    html: input.html?.trim() || `<p>${input.text.trim()}</p>`,
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
        userAgent: DASHBOARD_USER_AGENT,
        source: "dashboard",
        apiKeyId: null,
      },
      ...current.logs,
    ],
  }))
  return email
}

function cancelEmail(id: string) {
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
}

function addReceived(input: {
  from: string
  to: string
  subject: string
  text: string
}) {
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
}

function addSuppression(input: { email: string; reason: SuppressionReason }) {
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
}

function removeSuppression(id: string) {
  mutate((current) => ({
    ...current,
    suppressions: current.suppressions.filter((item) => item.id !== id),
  }))
}

function addBroadcast(input: {
  name: string
  subject: string
  preview: string
  segmentId: string | null
  topicId: string | null
}) {
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
        content: emptyEmailDocument(),
        status: "draft",
        segmentId: input.segmentId,
        topicId: input.topicId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scheduledAt: null,
        sentAt: null,
        stats: emptyBroadcastStats(),
      },
      ...current.broadcasts,
    ],
  }))
  return { id }
}

function updateBroadcast(
  id: string,
  patch: Partial<
    Pick<
      Broadcast,
      | "name"
      | "subject"
      | "preview"
      | "html"
      | "content"
      | "from"
      | "replyTo"
      | "segmentId"
      | "topicId"
    >
  >
) {
  mutate((current) => ({
    ...current,
    broadcasts: current.broadcasts.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
    ),
  }))
}

function setBroadcastStatus(
  id: string,
  status: BroadcastStatus,
  scheduledAt: number | null = null
) {
  mutate((current) => {
    const item = current.broadcasts.find((row) => row.id === id)
    if (!item) return current
    const now = Date.now()
    const recipients =
      status === "sent" ? broadcastRecipients(current.contacts, item) : []
    const next = transitionBroadcast(item, status, {
      now,
      recipients: recipients.length,
      scheduledAt,
    })
    if (next === item) return current
    const from = broadcastFrom(item, current.domains)
    const sent: SentEmail[] = recipients.map((contact) => ({
      id: createId("em"),
      from,
      to: contact.email,
      subject: item.subject,
      status: "delivered",
      createdAt: now,
      scheduledAt: null,
      html: item.html,
      text: item.preview,
      broadcastId: item.id,
      events: [
        { id: createId("evt"), type: "sent", at: now },
        { id: createId("evt"), type: "delivered", at: now },
      ],
    }))
    return {
      ...current,
      broadcasts: current.broadcasts.map((row) => (row.id === id ? next : row)),
      emails: [...sent, ...current.emails],
    }
  })
}

function duplicateBroadcast(id: string): { id: string } | null {
  const source = activeWorkspace(rootFromRaw(readRaw())).broadcasts.find(
    (item) => item.id === id
  )
  if (!source) return null
  const nextId = createId("brd")
  mutate((current) => {
    return {
      ...current,
      broadcasts: [
        {
          ...source,
          id: nextId,
          name: `${source.name || "Untitled"} copy`,
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          scheduledAt: null,
          sentAt: null,
          stats: emptyBroadcastStats(),
        },
        ...current.broadcasts,
      ],
    }
  })
  return { id: nextId }
}

function deleteBroadcast(id: string) {
  mutate((current) => ({
    ...current,
    broadcasts: current.broadcasts.filter((item) => item.id !== id),
  }))
}

function addTemplate(input: { name: string; subject: string; html?: string }) {
  const id = createId("tpl")
  mutate((current) => ({
    ...current,
    templates: [
      {
        id,
        name: input.name.trim(),
        subject: input.subject.trim(),
        html: input.html?.trim() ? input.html : "<p></p>",
        status: "draft",
        variables: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ...current.templates,
    ],
  }))
  return { id }
}

function updateTemplate(
  id: string,
  patch: Partial<Pick<EmailTemplate, "name" | "subject" | "html" | "variables">>
) {
  mutate((current) => ({
    ...current,
    templates: current.templates.map((item) =>
      item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
    ),
  }))
}

function setTemplateStatus(id: string, status: TemplateStatus) {
  mutate((current) => ({
    ...current,
    templates: current.templates.map((item) =>
      item.id === id ? { ...item, status, updatedAt: Date.now() } : item
    ),
  }))
}

function duplicateTemplate(id: string) {
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
}

function deleteTemplate(id: string) {
  mutate((current) => ({
    ...current,
    templates: current.templates.filter((item) => item.id !== id),
  }))
}

function addAutomation(input: { name: string; trigger: string }) {
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
}

function setAutomationStatus(id: string, status: AutomationStatus) {
  mutate((current) => ({
    ...current,
    automations: current.automations.map((item) =>
      item.id === id ? { ...item, status } : item
    ),
  }))
}

function deleteAutomation(id: string) {
  mutate((current) => ({
    ...current,
    automations: current.automations.filter((item) => item.id !== id),
  }))
}

function createWebhook(input: {
  endpoint: string
  events: WebhookEvent[]
}): CreateWebhookResult {
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
}

function updateWebhook(
  id: string,
  patch: Partial<Pick<Webhook, "endpoint" | "events" | "enabled">>
) {
  mutate((current) => ({
    ...current,
    webhooks: current.webhooks.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    ),
  }))
}

function deleteWebhook(id: string) {
  mutate((current) => ({
    ...current,
    webhooks: current.webhooks.filter((item) => item.id !== id),
  }))
}

function rotateWebhookSecret(id: string) {
  const secret = createWebhookSecret()
  mutate((current) => ({
    ...current,
    webhooks: current.webhooks.map((item) =>
      item.id === id ? { ...item, signingSecretLast4: secret.slice(-4) } : item
    ),
  }))
  return secret
}

function addExport(resource: string, rows: number) {
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
}

function updateSettings(
  patch: Partial<Settings> | ((current: Settings) => Settings)
) {
  mutate((current) => ({
    ...current,
    settings:
      typeof patch === "function"
        ? patch(current.settings)
        : { ...current.settings, ...patch },
  }))
}

function inviteMember(input: {
  name: string
  email: string
  role: MemberRole
}) {
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
}

function updateMemberRole(id: string, role: MemberRole) {
  mutate((current) => ({
    ...current,
    members: current.members.map((member) =>
      member.id === id ? { ...member, role } : member
    ),
  }))
}

function removeMember(id: string) {
  mutate((current) => ({
    ...current,
    members: current.members.filter((member) => member.id !== id || member.you),
  }))
}

function switchTeam(id: string) {
  mutateRoot((current) => switchTeamInRoot(current, id))
}

function createTeam(name: string) {
  let createdId = ""
  mutateRoot((current) => {
    const created = createTeamInRoot(current, name)
    createdId = created.teamId
    return created.root
  })
  return { id: createdId }
}

function resetDemo() {
  writeRoot(seedRoot())
}

const actions = {
  switchTeam,
  createTeam,
  addDomain,
  deleteDomain,
  updateDomain,
  verifyDomain,
  addContact,
  upsertContacts,
  updateContact,
  deleteContact,
  deleteContacts,
  setContactSegments,
  addContactsToSegments,
  setContactTopic,
  subscribeContactsToTopics,
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
  duplicateBroadcast,
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
  resetDemo,
}

export type DashboardStore = {
  state: DashboardState
  teams: Team[]
  activeTeamId: string
} & typeof actions

const DashboardContext = createContext<DashboardStore | null>(null)

export function DashboardProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => SERVER_SNAPSHOT)
  const value = useMemo<DashboardStore>(() => {
    const root = rootFromRaw(raw)
    return {
      state: activeWorkspace(root),
      teams: listTeams(root),
      activeTeamId: root.activeTeamId,
      ...actions,
    }
  }, [raw])

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
