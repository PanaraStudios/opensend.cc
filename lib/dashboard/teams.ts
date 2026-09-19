import { normalizeAutomation } from "./automation"
import { broadcastUpdatedAt, normalizeBroadcastStats } from "./broadcast"
import { SEED_ACCOUNT, SEED_STATE } from "./data"
import { normalizeDomain } from "./domains"
import { createId } from "./ids"
import { normalizeLog } from "./logs"
import { uniqueSlug } from "./slug"
import { normalizeTemplates } from "./template"
import {
  AUTH_PROVIDERS,
  type Account,
  type AuthProvider,
  type DashboardState,
  type Team,
} from "./types"
import { normalizeWebhook } from "./webhooks"

export const SEED_TEAM_ID = "team_opensend"
export const ROOT_VERSION = 3 as const

export type DashboardRoot = {
  version: typeof ROOT_VERSION
  activeTeamId: string
  account: Account
  workspaces: Record<string, DashboardState>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function isDashboardState(value: unknown): value is DashboardState {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.domains) || !Array.isArray(value.contacts)) {
    return false
  }
  if (!Array.isArray(value.emails) || !Array.isArray(value.broadcasts)) {
    return false
  }
  return isRecord(value.settings)
}

export function seedRoot(): DashboardRoot {
  return {
    version: ROOT_VERSION,
    activeTeamId: SEED_TEAM_ID,
    account: SEED_ACCOUNT,
    workspaces: { [SEED_TEAM_ID]: SEED_STATE },
  }
}

export function serializeRoot(root: DashboardRoot): string {
  return JSON.stringify(root)
}

/** Backfill fields added after a workspace was persisted. Runs on every
    parse; the result is memoised on the raw string by the store. */
function migrateWorkspace(workspace: DashboardState): DashboardState {
  return {
    ...workspace,
    domains: workspace.domains.map(normalizeDomain),
    broadcasts: workspace.broadcasts.map((item) => ({
      ...item,
      updatedAt: broadcastUpdatedAt(item),
      stats: normalizeBroadcastStats(item.stats),
    })),
    logs: (workspace.logs ?? []).map(normalizeLog),
    templates: normalizeTemplates(workspace.templates),
    /* A workspace saved before automations had workflows gets the seeded
       workflow, events and runs of whichever seeded automations it still has. */
    automations: workspace.automations.map((item) => {
      const seed = item.steps
        ? undefined
        : SEED_STATE.automations.find((entry) => entry.id === item.id)
      return normalizeAutomation(
        seed ? { ...item, trigger: seed.trigger, steps: seed.steps } : item
      )
    }),
    automationEvents: workspace.automationEvents ?? SEED_STATE.automationEvents,
    automationRuns:
      workspace.automationRuns ??
      SEED_STATE.automationRuns.filter((run) =>
        workspace.automations.some((item) => item.id === run.automationId)
      ),
    webhooks: workspace.webhooks.map(normalizeWebhook),
    /* A workspace saved before deliveries were kept gets the seeded history
       of whichever seeded webhooks it still has. */
    webhookDeliveries:
      workspace.webhookDeliveries ??
      SEED_STATE.webhookDeliveries.filter((delivery) =>
        workspace.webhooks.some((item) => item.id === delivery.webhookId)
      ),
  }
}

function parseWorkspaces(
  value: unknown
): Record<string, DashboardState> | null {
  if (!isRecord(value)) return null
  const workspaces: Record<string, DashboardState> = {}
  for (const [id, workspace] of Object.entries(value)) {
    if (isDashboardState(workspace)) {
      workspaces[id] = migrateWorkspace(workspace)
    }
  }
  return Object.keys(workspaces).length > 0 ? workspaces : null
}

/** A root saved before accounts existed gets the seeded one. */
function parseAccount(value: unknown): Account {
  if (!isRecord(value) || !Array.isArray(value.providers)) return SEED_ACCOUNT
  const providers = value.providers.filter(
    (item): item is Account["providers"][number] =>
      isRecord(item) &&
      AUTH_PROVIDERS.includes(item.provider as AuthProvider) &&
      typeof item.connectedAt === "number"
  )
  const mfa =
    isRecord(value.mfa) &&
    typeof value.mfa.secret === "string" &&
    typeof value.mfa.enabledAt === "number"
      ? { secret: value.mfa.secret, enabledAt: value.mfa.enabledAt }
      : null
  return { providers, mfa }
}

export function parseRoot(raw: string): DashboardRoot {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && parsed.version === ROOT_VERSION) {
      const workspaces = parseWorkspaces(parsed.workspaces)
      if (workspaces) {
        const activeTeamId =
          typeof parsed.activeTeamId === "string" &&
          workspaces[parsed.activeTeamId]
            ? parsed.activeTeamId
            : Object.keys(workspaces)[0]!
        return {
          version: ROOT_VERSION,
          activeTeamId,
          account: parseAccount(parsed.account),
          workspaces,
        }
      }
    }
    if (isDashboardState(parsed)) {
      return {
        version: ROOT_VERSION,
        activeTeamId: SEED_TEAM_ID,
        account: SEED_ACCOUNT,
        workspaces: { [SEED_TEAM_ID]: migrateWorkspace(parsed) },
      }
    }
  } catch {
    // Fall through to the seeded root.
  }
  return seedRoot()
}

export function listTeams(root: DashboardRoot): Team[] {
  const removable = Object.keys(root.workspaces).length > 1
  return Object.entries(root.workspaces).map(([id, workspace]) => {
    const you = workspace.members.find((member) => member.you)
    return {
      id,
      name: workspace.settings.teamName,
      slug: workspace.settings.teamSlug,
      avatar: workspace.settings.teamAvatar,
      role: you?.role ?? "member",
      joinedAt: you?.createdAt ?? 0,
      members: workspace.members.length,
      removable,
    }
  })
}

export function activeWorkspace(root: DashboardRoot): DashboardState {
  return root.workspaces[root.activeTeamId] ?? SEED_STATE
}

export function emptyWorkspace(name: string, slug: string): DashboardState {
  return {
    domains: [],
    contacts: [],
    segments: [],
    topics: [],
    properties: [],
    apiKeys: [],
    members: SEED_STATE.members
      .filter((member) => member.you)
      .map((member) => ({ ...member })),
    emails: [],
    received: [],
    suppressions: [],
    broadcasts: [],
    templates: [],
    automations: [],
    automationEvents: [],
    automationRuns: [],
    webhooks: [],
    webhookDeliveries: [],
    logs: [],
    exports: [],
    settings: {
      ...SEED_STATE.settings,
      teamName: name,
      teamSlug: slug,
      unsubscribe: {
        ...SEED_STATE.settings.unsubscribe,
        brandName: name,
      },
      ses: {
        ...SEED_STATE.settings.ses,
        connected: false,
        accessKeyLast4: "",
        configurationSet: "",
      },
      smtp: {
        ...SEED_STATE.settings.smtp,
        enabled: false,
      },
    },
  }
}

export function switchTeamInRoot(
  root: DashboardRoot,
  teamId: string
): DashboardRoot {
  if (!root.workspaces[teamId] || root.activeTeamId === teamId) return root
  return { ...root, activeTeamId: teamId }
}

export function createTeamInRoot(
  root: DashboardRoot,
  name: string
): { root: DashboardRoot; teamId: string } {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error("Enter a team name")
  }
  const slug = uniqueSlug(
    trimmed,
    Object.values(root.workspaces).map(
      (workspace) => workspace.settings.teamSlug
    ),
    "team"
  )
  const teamId = createId("team")
  const workspace = emptyWorkspace(trimmed, slug)
  /* Whoever creates a team is its admin, as they are known now, from now. */
  const you = activeWorkspace(root).members.find((member) => member.you)
  return {
    teamId,
    root: {
      ...root,
      activeTeamId: teamId,
      workspaces: {
        ...root.workspaces,
        [teamId]: {
          ...workspace,
          members: workspace.members.map((member) => ({
            ...member,
            ...(you ? { name: you.name, email: you.email } : null),
            role: "admin" as const,
            createdAt: Date.now(),
          })),
        },
      },
    },
  }
}

export function renameTeamInRoot(
  root: DashboardRoot,
  teamId: string,
  name: string
): DashboardRoot {
  const workspace = root.workspaces[teamId]
  const trimmed = name.trim()
  if (!workspace || !trimmed) return root
  return {
    ...root,
    workspaces: {
      ...root.workspaces,
      [teamId]: {
        ...workspace,
        settings: { ...workspace.settings, teamName: trimmed },
      },
    },
  }
}

/** Deleting a team and leaving one are the same thing here: the workspace
    goes. The last team stays, since there is nothing to show without one. */
export function deleteTeamInRoot(
  root: DashboardRoot,
  teamId: string
): DashboardRoot {
  if (!root.workspaces[teamId]) return root
  const workspaces = Object.fromEntries(
    Object.entries(root.workspaces).filter(([id]) => id !== teamId)
  )
  const remaining = Object.keys(workspaces)
  if (remaining.length === 0) return root
  return {
    ...root,
    activeTeamId:
      root.activeTeamId === teamId ? remaining[0]! : root.activeTeamId,
    workspaces,
  }
}

/** Your email is on your member record in every team. */
export function updateEmailInRoot(
  root: DashboardRoot,
  email: string
): DashboardRoot {
  const next = email.trim().toLowerCase()
  return {
    ...root,
    workspaces: Object.fromEntries(
      Object.entries(root.workspaces).map(([id, workspace]) => [
        id,
        {
          ...workspace,
          members: workspace.members.map((member) =>
            member.you ? { ...member, email: next } : member
          ),
        },
      ])
    ),
  }
}
