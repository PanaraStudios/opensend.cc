"use client"

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  cancelledRun,
  cleanSchema,
  duplicatedAutomation,
  eventNameError,
  flattenSteps,
  keptRuns,
  startRun,
  UNTITLED_AUTOMATION,
} from "./automation"
import {
  emailFrom,
  broadcastRecipients,
  emptyBroadcastStats,
  transitionBroadcast,
} from "./broadcast"
import { defaultTopicSubscription, normalizePropertyKey } from "./contacts"
import { recordsForDomain } from "./data"
import {
  DEFAULT_RETURN_PATH,
  normalizeDomainName,
  reconcileDomain,
  verifyDomainRecords,
} from "./domains"
import { normalizeEmail } from "./format"
import { createId, createToken, createWebhookSecret, tokenParts } from "./ids"
import { DASHBOARD_USER_AGENT } from "./logs"
import {
  activeWorkspace,
  createTeamInRoot,
  deleteTeamInRoot,
  renameTeamInRoot,
  updateEmailInRoot,
  youOf,
  listTeams,
  parseRoot,
  seedRoot,
  serializeRoot,
  switchTeamInRoot,
  type DashboardRoot,
} from "./teams"
import {
  publishedAtAfterEdit,
  renamedTemplateAlias,
  templateVariables,
  UNTITLED_TEMPLATE,
  uniqueTemplateAlias,
  type TemplateInput,
} from "./template"
import { replayedDelivery } from "./webhooks"
import type {
  Account,
  AuthProvider,
  ApiKey,
  ApiKeyPermission,
  Automation,
  AutomationEvent,
  AutomationStatus,
  Broadcast,
  BroadcastStatus,
  Contact,
  CreateApiKeyResult,
  DashboardState,
  Domain,
  EmailStatus,
  EmailDraft,
  EmailTemplate,
  MemberRole,
  PropertyType,
  Region,
  SentEmail,
  Settings,
  SuppressionReason,
  Team,
  TeamMember,
  TemplateStatus,
  Topic,
  TopicDefault,
  TopicSubscription,
  TopicVisibility,
  Webhook,
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
  const you = youOf(activeWorkspace(rootFromRaw(readRaw())))
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
        html: "",
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
    const from = emailFrom(item, current.domains)
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

function addTemplate(input: TemplateInput) {
  const id = createId("tpl")
  mutate((current) => {
    const name = input.name.trim() || UNTITLED_TEMPLATE
    return {
      ...current,
      templates: [
        {
          id,
          name,
          alias: uniqueTemplateAlias(name, current.templates),
          subject: input.subject.trim(),
          preview: input.preview ?? "",
          html: input.html ?? "",
          content: input.content,
          from: input.from,
          replyTo: input.replyTo,
          status: "draft",
          variables: templateVariables({
            subject: input.subject,
            preview: input.preview ?? "",
            html: input.html ?? "",
          }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          publishedAt: null,
        },
        ...current.templates,
      ],
    }
  })
  return { id }
}

function updateTemplate(
  id: string,
  patch: Partial<Omit<EmailDraft, "id"> & Pick<EmailTemplate, "alias">>
) {
  const now = Date.now()
  mutate((current) => ({
    ...current,
    templates: current.templates.map((item) => {
      if (item.id !== id) return item
      /* A template is listed and deleted by its name, so it always has one. */
      const name =
        patch.name === undefined
          ? undefined
          : patch.name.trim() || UNTITLED_TEMPLATE
      const next = { ...item, ...patch, name: name ?? item.name }
      return {
        ...next,
        alias:
          patch.alias ?? renamedTemplateAlias(item, name, current.templates),
        variables: templateVariables(next),
        updatedAt: now,
        publishedAt: publishedAtAfterEdit(item, patch, now),
      }
    }),
  }))
}

function setTemplateStatus(id: string, status: TemplateStatus) {
  const now = Date.now()
  mutate((current) => ({
    ...current,
    templates: current.templates.map((item) =>
      item.id === id
        ? {
            ...item,
            status,
            updatedAt: now,
            publishedAt: status === "published" ? now : item.publishedAt,
          }
        : item
    ),
  }))
}

function duplicateTemplate(id: string): { id: string } | null {
  const source = activeWorkspace(rootFromRaw(readRaw())).templates.find(
    (item) => item.id === id
  )
  if (!source) return null
  const nextId = createId("tpl")
  mutate((current) => {
    const name = `${source.name} copy`
    return {
      ...current,
      templates: [
        {
          ...source,
          id: nextId,
          name,
          alias: uniqueTemplateAlias(name, current.templates),
          status: "draft",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          publishedAt: null,
        },
        ...current.templates,
      ],
    }
  })
  return { id: nextId }
}

function deleteTemplate(id: string) {
  mutate((current) => ({
    ...current,
    templates: current.templates.filter((item) => item.id !== id),
  }))
}

/** A new automation is blank and disabled; it is set up in the editor. */
function addAutomation() {
  const id = createId("atm")
  mutate((current) => ({
    ...current,
    automations: [
      {
        id,
        name: UNTITLED_AUTOMATION,
        trigger: "",
        status: "disabled",
        steps: [],
        createdAt: Date.now(),
      },
      ...current.automations,
    ],
  }))
  return { id }
}

/* Naming an event nobody has sent yet is how one gets defined. */
function withAutomationEvents(
  events: readonly AutomationEvent[],
  names: readonly string[]
): AutomationEvent[] {
  return names.reduce<AutomationEvent[]>(
    (all, name) =>
      eventNameError(
        name,
        all.map((item) => item.name)
      )
        ? all
        : [
            ...all,
            {
              id: createId("evt"),
              name: name.trim(),
              schema: [],
              createdAt: Date.now(),
            },
          ],
    /* Never written to: with nothing to add, the same list comes back. */
    events as AutomationEvent[]
  )
}

/** The workflow of an enabled automation is fixed: runs in flight finish on
    the version they started with. Its name can change at any time. */
function updateAutomation(
  id: string,
  patch: Partial<Pick<Automation, "name" | "trigger" | "steps">>
) {
  mutate((current) => {
    const item = current.automations.find((entry) => entry.id === id)
    if (!item) return current
    const locked = item.status === "enabled"
    const next: Automation = {
      ...item,
      name:
        patch.name === undefined
          ? item.name
          : patch.name.trim() || UNTITLED_AUTOMATION,
      trigger: locked ? item.trigger : (patch.trigger?.trim() ?? item.trigger),
      steps: locked ? item.steps : (patch.steps ?? item.steps),
    }
    const automations = current.automations.map((entry) =>
      entry.id === id ? next : entry
    )
    /* A rename names no events. */
    if (patch.trigger === undefined && patch.steps === undefined) {
      return { ...current, automations }
    }
    const waitedFor = flattenSteps(next.steps).flatMap((step) =>
      step.type === "wait_for_event" ? [step.eventName] : []
    )
    return {
      ...current,
      automations,
      automationEvents: withAutomationEvents(current.automationEvents, [
        next.trigger,
        ...waitedFor,
      ]),
    }
  })
}

function setAutomationStatus(id: string, status: AutomationStatus) {
  mutate((current) => ({
    ...current,
    automations: current.automations.map((item) =>
      item.id === id ? { ...item, status } : item
    ),
  }))
}

function duplicateAutomation(id: string): { id: string } | null {
  const nextId = createId("atm")
  let made = false
  mutate((current) => {
    const source = current.automations.find((item) => item.id === id)
    if (!source) return current
    made = true
    return {
      ...current,
      automations: [
        duplicatedAutomation(source, nextId, Date.now()),
        ...current.automations,
      ],
    }
  })
  return made ? { id: nextId } : null
}

function deleteAutomation(id: string) {
  mutate((current) => ({
    ...current,
    automations: current.automations.filter((item) => item.id !== id),
    automationRuns: current.automationRuns.filter(
      (run) => run.automationId !== id
    ),
  }))
}

/** Sends the trigger event for one contact and starts a run. */
function runAutomation(
  id: string,
  input: { contactId: string; payload: Record<string, unknown> }
): boolean {
  let made = false
  mutate((current) => {
    const automation = current.automations.find((item) => item.id === id)
    const contact = current.contacts.find((item) => item.id === input.contactId)
    if (!automation || !contact) return current
    made = true
    return {
      ...current,
      automationRuns: keptRuns([
        startRun({
          id: createId("run"),
          automation,
          contact,
          payload: input.payload,
          context: current,
          now: Date.now(),
        }),
        ...current.automationRuns,
      ]),
    }
  })
  return made
}

function cancelAutomationRun(id: string) {
  mutate((current) => ({
    ...current,
    automationRuns: current.automationRuns.map((run) =>
      run.id === id ? cancelledRun(run, Date.now()) : run
    ),
  }))
}

function saveAutomationEvent(
  input: Pick<AutomationEvent, "name" | "schema"> & { id?: string }
) {
  mutate((current) => {
    const name = input.name.trim()
    const schema = cleanSchema(input.schema)
    if (input.id) {
      return {
        ...current,
        automationEvents: current.automationEvents.map((item) =>
          item.id === input.id ? { ...item, name, schema } : item
        ),
      }
    }
    return {
      ...current,
      automationEvents: [
        ...current.automationEvents,
        { id: createId("evt"), name, schema, createdAt: Date.now() },
      ],
    }
  })
}

function deleteAutomationEvent(id: string) {
  mutate((current) => ({
    ...current,
    automationEvents: current.automationEvents.filter((item) => item.id !== id),
  }))
}

function createWebhook(input: Pick<Webhook, "endpoint" | "events">) {
  const id = createId("wh")
  mutate((current) => ({
    ...current,
    webhooks: [
      {
        id,
        endpoint: input.endpoint.trim(),
        events: input.events,
        enabled: true,
        signingSecret: createWebhookSecret(),
        createdAt: Date.now(),
      },
      ...current.webhooks,
    ],
  }))
  return { id }
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
    webhookDeliveries: current.webhookDeliveries.filter(
      (item) => item.webhookId !== id
    ),
  }))
}

function replayWebhookDelivery(id: string): { id: string } | null {
  const source = activeWorkspace(rootFromRaw(readRaw())).webhookDeliveries.find(
    (item) => item.id === id
  )
  if (!source) return null
  const next = replayedDelivery(source, createId("whd"), Date.now())
  mutate((current) => ({
    ...current,
    webhookDeliveries: [next, ...current.webhookDeliveries],
  }))
  return { id: next.id }
}

function rotateWebhookSecret(id: string) {
  const signingSecret = createWebhookSecret()
  mutate((current) => ({
    ...current,
    webhooks: current.webhooks.map((item) =>
      item.id === id ? { ...item, signingSecret } : item
    ),
  }))
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

function inviteMember(input: { email: string; role: MemberRole }) {
  const email = normalizeEmail(input.email)
  mutate((current) => ({
    ...current,
    members: [
      ...current.members,
      {
        id: createId("mem"),
        /* An invite asks for the address alone. */
        name: email.split("@")[0] ?? email,
        email,
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

function renameTeam(id: string, name: string) {
  mutateRoot((current) => renameTeamInRoot(current, id, name))
}

/** Also how you leave a team: here, the workspace goes either way. */
function deleteTeam(id: string) {
  mutateRoot((current) => deleteTeamInRoot(current, id))
}

function updateEmail(email: string) {
  mutateRoot((current) => updateEmailInRoot(current, email))
}

function updateAccount(patch: (current: Account) => Account) {
  mutateRoot((current) => ({ ...current, account: patch(current.account) }))
}

function linkProvider(provider: AuthProvider) {
  updateAccount((account) =>
    account.providers.some((item) => item.provider === provider)
      ? account
      : {
          ...account,
          providers: [
            ...account.providers,
            { provider, connectedAt: Date.now() },
          ],
        }
  )
}

/** The last way in cannot be unlinked. */
function unlinkProvider(provider: AuthProvider) {
  updateAccount((account) =>
    account.providers.length < 2
      ? account
      : {
          ...account,
          providers: account.providers.filter(
            (item) => item.provider !== provider
          ),
        }
  )
}

function setMfa(secret: string | null) {
  updateAccount((account) => ({
    ...account,
    mfa: secret ? { secret, enabledAt: Date.now() } : null,
  }))
}

function resetDemo() {
  writeRoot(seedRoot())
}

const actions = {
  switchTeam,
  createTeam,
  renameTeam,
  deleteTeam,
  updateEmail,
  linkProvider,
  unlinkProvider,
  setMfa,
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
  updateAutomation,
  setAutomationStatus,
  duplicateAutomation,
  deleteAutomation,
  runAutomation,
  cancelAutomationRun,
  saveAutomationEvent,
  deleteAutomationEvent,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  rotateWebhookSecret,
  replayWebhookDelivery,
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
  /* There is always one: the last team cannot be deleted. */
  activeTeam: Team
  /** Your member record in the open team. */
  you: TeamMember | undefined
  account: Account
} & typeof actions

const DashboardContext = createContext<DashboardStore | null>(null)

const subscribeNever = () => () => {}

/** False on the server and on the first client render, which both show the
    seed data; true once the saved state is what is being rendered. Anything
    that copies state into its own on mount should wait for this. */
export function useStoreHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false
  )
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => SERVER_SNAPSHOT)
  const value = useMemo<DashboardStore>(() => {
    const root = rootFromRaw(raw)
    const state = activeWorkspace(root)
    const teams = listTeams(root)
    return {
      state,
      teams,
      activeTeamId: root.activeTeamId,
      activeTeam:
        teams.find((team) => team.id === root.activeTeamId) ?? teams[0]!,
      you: youOf(state),
      account: root.account,
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
