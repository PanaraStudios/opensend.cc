import { normalizeAutomation } from "./automation"
import { broadcastUpdatedAt, normalizeBroadcastStats } from "./broadcast"
import { SEED_STATE } from "./data"
import { normalizeDomain } from "./domains"
import { createId } from "./ids"
import { normalizeLog } from "./logs"
import { uniqueSlug } from "./slug"
import { normalizeTemplates } from "./template"
import type { DashboardState, Team } from "./types"
import { normalizeWebhook } from "./webhooks"

export const SEED_TEAM_ID = "team_opensend"
export const ROOT_VERSION = 3 as const

export type DashboardRoot = {
  version: typeof ROOT_VERSION
  activeTeamId: string
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
          workspaces,
        }
      }
    }
    if (isDashboardState(parsed)) {
      return {
        version: ROOT_VERSION,
        activeTeamId: SEED_TEAM_ID,
        workspaces: { [SEED_TEAM_ID]: migrateWorkspace(parsed) },
      }
    }
  } catch {
    // Fall through to the seeded root.
  }
  return seedRoot()
}

export function listTeams(root: DashboardRoot): Team[] {
  return Object.entries(root.workspaces).map(([id, workspace]) => ({
    id,
    name: workspace.settings.teamName,
    slug: workspace.settings.teamSlug,
  }))
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
  return {
    teamId,
    root: {
      ...root,
      activeTeamId: teamId,
      workspaces: {
        ...root.workspaces,
        [teamId]: emptyWorkspace(trimmed, slug),
      },
    },
  }
}
