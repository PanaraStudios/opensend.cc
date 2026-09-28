"use client"

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import {
  emailFrom,
  broadcastRecipients,
  emptyBroadcastStats,
  transitionBroadcast,
} from "./broadcast"
import { createId } from "./ids"
import { exportFileName } from "./exports"
import { slugify } from "./slug"
import { DASHBOARD_USER_AGENT } from "./logs"
import { useMutation, useAction, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { asDomain } from "@/lib/domains/use-domains"
import { asTemplate } from "@/lib/templates/use-templates"
import {
  asContact,
  useProperties,
  useSegments,
  useTopics,
} from "@/lib/audience/use-audience"
import { asApiKey } from "@/lib/api-keys/use-api-keys"
import { asEmail } from "@/lib/emails/use-emails"
import { asAutomationEvent } from "@/lib/automation-events/use-automation-events"
import { SEED_STATE } from "./data"
import { useWorkspace } from "@/components/auth/workspace"
import { authClient, authResult } from "@/lib/auth/client"

import {
  activeWorkspace,
  parseRoot,
  seedRoot,
  serializeRoot,
  type DashboardRoot,
} from "./teams"
import type {
  Broadcast,
  BroadcastStatus,
  DashboardState,
  EmailStatus,
  MemberRole,
  SentEmail,
  Settings,
  Team,
  TeamMember,
} from "./types"

let storageKey = "opensend.demo.uninitialized"
const CHANGE_EVENT = "opensend-dashboard"

const SERVER_SNAPSHOT = serializeRoot(seedRoot())

function emitChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function readRaw(): string {
  try {
    const current = localStorage.getItem(storageKey)
    if (current) return current
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
  const raw = serializeRoot({
    ...next,
    account: { providers: [], mfa: null },
    workspaces: Object.fromEntries(
      Object.entries(next.workspaces).map(([id, workspace]) => [
        id,
        {
          ...workspace,
          members: [],
          settings: {
            ...workspace.settings,
            sso: { enabled: false, issuer: "", clientId: "" },
          },
        },
      ])
    ),
  })
  cachedRaw = raw
  cachedRoot = next
  localStorage.setItem(storageKey, raw)
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

function addExport(resource: string, rows: number) {
  const createdAt = Date.now()
  mutate((current) => ({
    ...current,
    exports: [
      {
        id: createId("exp"),
        resource,
        fileName: exportFileName(slugify(resource), createdAt),
        status: "ready",
        createdAt,
        expiresAt: createdAt + 7 * 86_400_000,
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

function resetDemo() {
  writeRoot(seedRoot())
}

const actions = {
  sendEmail,
  addReceived,
  addBroadcast,
  updateBroadcast,
  duplicateBroadcast,
  setBroadcastStatus,
  deleteBroadcast,
  addExport,
  updateSettings,
  resetDemo,
}

export type DashboardStore = {
  state: DashboardState
  teams: Team[]
  activeTeamId: string
  activeTeam: Team
  you: TeamMember | undefined
  switchTeam: (id: string) => Promise<unknown>
  createTeam: (name: string) => Promise<unknown>
  renameTeam: (id: string, name: string) => Promise<unknown>
  deleteTeam: (id: string, leave?: boolean) => Promise<unknown>
  updateEmail: (email: string) => Promise<unknown>
  setTeamAvatar: (
    teamId: string,
    avatar: string | undefined
  ) => Promise<unknown>
  inviteMember: (input: { email: string; role: MemberRole }) => Promise<unknown>
  updateMemberRole: (id: string, role: MemberRole) => Promise<unknown>
  removeMember: (id: string) => Promise<unknown>
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
  const auth = useWorkspace()
  useEffect(() => {
    // These old demo roots could contain plaintext authenticator secrets.
    localStorage.removeItem("opensend.dashboard.v2")
    localStorage.removeItem("opensend.dashboard.v3")
  }, [])
  const scope = `opensend.demo.v4:${auth.user.id}:${auth.activeTeamId ?? "account"}`
  const read = useCallback(() => {
    storageKey = scope
    return readRaw()
  }, [scope])
  const raw = useSyncExternalStore(subscribe, read, () => SERVER_SNAPSHOT)
  /* Screens outside the domain pages (API keys, broadcasts, receiving, the
     command menu) read the team's domains from the store. One page covers
     them; the domain list itself paginates on its own. */
  const domainPage = useQuery(
    api.domains.list,
    auth.activeTeamId
      ? {
          organizationId: auth.activeTeamId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip"
  )
  const domains = useMemo(
    () => domainPage?.page.map(asDomain) ?? [],
    [domainPage]
  )
  /* Automations pick templates from the store; the templates pages query
     their own. Bodies stay out, so an autosave does not resend them. */
  const templateRows = useQuery(
    api.templates.options,
    auth.activeTeamId ? { organizationId: auth.activeTeamId } : "skip"
  )
  const templates = useMemo(
    () => templateRows?.map((row) => asTemplate(row)) ?? [],
    [templateRows]
  )
  /* The audience is real as well. Demo screens that read it (broadcasts,
     automations, the editor's merge tags) get
     every segment, topic and property, and the newest page of contacts. */
  const segments = useSegments()
  const topics = useTopics()
  const properties = useProperties()
  const contactPage = useQuery(
    api.contacts.list,
    auth.activeTeamId
      ? {
          organizationId: auth.activeTeamId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip"
  )
  const contacts = useMemo(
    () => contactPage?.page.map(asContact) ?? [],
    [contactPage]
  )
  /* API keys and logs are real; screens that still run on the demo read
     the team's keys from here, and demo logs are gone. */
  const keyPage = useQuery(
    api.apiKeys.list,
    auth.activeTeamId
      ? {
          organizationId: auth.activeTeamId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip"
  )
  const apiKeys = useMemo(() => keyPage?.page.map(asApiKey) ?? [], [keyPage])
  /* Sent email is real too. Screens still on the demo (metrics, broadcast
     reports) read the team's newest page from here; suppressions are read
     only by their own screen. */
  const emailPage = useQuery(
    api.emails.list,
    auth.activeTeamId
      ? {
          organizationId: auth.activeTeamId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip"
  )
  const emails = useMemo(
    () => emailPage?.page.map((row) => asEmail(row)) ?? [],
    [emailPage]
  )
  /* Custom events are real. The builder's event picker reads the newest
     page from here; the events page paginates on its own. */
  const eventPage = useQuery(
    api.automationEvents.list,
    auth.activeTeamId
      ? {
          organizationId: auth.activeTeamId,
          paginationOpts: { numItems: 100, cursor: null },
        }
      : "skip"
  )
  const automationEvents = useMemo(
    () => eventPage?.page.map(asAutomationEvent) ?? [],
    [eventPage]
  )
  const create = useMutation(api.teams.create)
  const switchTeam = useMutation(api.teams.switchTeam)
  const rename = useMutation(api.teams.rename)
  const remove = useMutation(api.teams.remove)
  const invite = useMutation(api.teams.invite)
  const changeMember = useMutation(api.teams.changeMember)
  const upload = useAction(api.teams.uploadAvatar)
  const avatar = useMutation(api.teams.removeAvatar)
  const value = useMemo<DashboardStore>(() => {
    const root = rootFromRaw(raw)
    const demo = activeWorkspace(root)
    const teams = auth.teams.map((t) => ({ ...t, removable: true }))
    const activeTeam: Team = teams.find((t) => t.id === auth.activeTeamId) ?? {
      id: "",
      name: "Account",
      slug: "",
      role: "member" as const,
      joinedAt: 0,
      members: 0,
      removable: false,
    }
    const members: TeamMember[] = auth.members.map((m) => ({
      ...m,
      createdAt: m.joinedAt,
    }))
    const you: TeamMember = members.find((m) => m.you) ?? {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      role: "member",
      createdAt: auth.user.createdAt,
      you: true,
      mfa: auth.user.mfa,
    }
    return {
      ...actions,
      state: {
        ...demo,
        domains,
        templates,
        contacts,
        segments: segments ?? [],
        topics: topics ?? [],
        properties: properties ?? [],
        apiKeys,
        emails,
        suppressions: [],
        automationEvents,
        automations: [],
        automationRuns: [],
        logs: [],
        // Real exports list on their own; only exports of demo lists stay.
        exports: demo.exports.filter(
          (item) => !SEED_STATE.exports.some((seed) => seed.id === item.id)
        ),
        members,
        settings: {
          ...demo.settings,
          teamName: activeTeam.name,
          teamSlug: activeTeam.slug,
          teamAvatar: activeTeam.avatar,
        },
      },
      teams,
      activeTeamId: activeTeam.id,
      activeTeam,
      you,
      switchTeam: (id) => switchTeam({ organizationId: id }),
      createTeam: (name) => create({ name }),
      renameTeam: (id, name) => rename({ organizationId: id, name }),
      deleteTeam: (id, leave = false) => remove({ organizationId: id, leave }),
      updateEmail: async (email) =>
        authResult(
          await authClient.changeEmail({
            newEmail: email,
            callbackURL: "/profile",
          })
        ),
      inviteMember: (input) =>
        invite({ ...input, organizationId: activeTeam.id }),
      updateMemberRole: (id, role) =>
        changeMember({ organizationId: activeTeam.id, memberId: id, role }),
      removeMember: (id) =>
        changeMember({ organizationId: activeTeam.id, memberId: id }),
      setTeamAvatar: async (id, data) => {
        if (!data) return avatar({ organizationId: id })
        const blob = await (await fetch(data)).blob()
        return upload({
          organizationId: id,
          bytes: await blob.arrayBuffer(),
          contentType: blob.type,
        })
      },
    }
  }, [
    raw,
    auth,
    domains,
    templates,
    contacts,
    segments,
    topics,
    properties,
    apiKeys,
    emails,
    automationEvents,
    create,
    switchTeam,
    rename,
    remove,
    invite,
    changeMember,
    upload,
    avatar,
  ])
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
