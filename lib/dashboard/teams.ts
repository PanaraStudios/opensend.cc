import { createId, SEED_STATE } from "./data"
import type { DashboardState, Team } from "./types"

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

function parseWorkspaces(
  value: unknown
): Record<string, DashboardState> | null {
  if (!isRecord(value)) return null
  const workspaces: Record<string, DashboardState> = {}
  for (const [id, workspace] of Object.entries(value)) {
    if (isDashboardState(workspace)) {
      workspaces[id] = workspace
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
        workspaces: { [SEED_TEAM_ID]: parsed },
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

export function slugifyTeamName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

export function uniqueTeamSlug(
  name: string,
  existing: readonly string[]
): string {
  const taken = new Set(existing)
  const base = slugifyTeamName(name) || "team"
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
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
    webhooks: [],
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
  const slug = uniqueTeamSlug(
    trimmed,
    Object.values(root.workspaces).map(
      (workspace) => workspace.settings.teamSlug
    )
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
