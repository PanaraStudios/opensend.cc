/** Session-start CRM block. Absent on a bot means the lookup is on. */
export const CALLER_CONTEXT_LIMIT = 2000
export const CALLER_CONTEXT_TIMEOUT_MS = 800
export const CALLER_CONTEXT_HEADER =
  "Caller context (from the CRM; do not read it out unless relevant):"

export class CallerContextTimeout extends Error {
  constructor() {
    super("caller_context_timeout")
    this.name = "CallerContextTimeout"
  }
}

export function callerContextEnabled(value: boolean | undefined) {
  return value !== false
}

export function callerContextPastDeadline(
  deadline: number,
  now: () => number = Date.now
) {
  return now() > deadline
}

export type CallerChannelIdentity = {
  channel: string
  externalId: string
  scopeId: string
  phone: string | null
  userId: string | null
  parentUserId: string | null
  username: string | null
  profileName: string | null
}

export type CallerProfile = {
  name: string
  email: string | null
  phone: string | null
  properties: Record<string, string>
  tags: string[]
  channelIdentities: CallerChannelIdentity[]
  recentMessageSummary: string
}

export type CallerLookup =
  | { found: false; phone: string | null }
  | ({ found: true } & CallerProfile)

export function formatCallerContext(lookup: CallerLookup) {
  if (!lookup.found) {
    const phone = lookup.phone?.trim()
    return cap(
      `${CALLER_CONTEXT_HEADER} Caller not found in CRM; phone ${phone || "unknown"}`
    )
  }
  const lines = [CALLER_CONTEXT_HEADER]
  if (lookup.name.trim()) lines.push(`name: ${lookup.name.trim()}`)
  if (lookup.email?.trim()) lines.push(`email: ${lookup.email.trim()}`)
  if (lookup.phone?.trim()) lines.push(`phone: ${lookup.phone.trim()}`)
  if (Object.keys(lookup.properties).length)
    lines.push(`properties: ${JSON.stringify(lookup.properties)}`)
  if (lookup.tags.length) lines.push(`tags: ${lookup.tags.join(", ")}`)
  if (lookup.channelIdentities.length)
    lines.push(
      `channelIdentities: ${JSON.stringify(lookup.channelIdentities)}`
    )
  if (lookup.recentMessageSummary.trim())
    lines.push(`recent messages:\n${lookup.recentMessageSummary.trim()}`)
  return cap(lines.join("\n"))
}

function cap(value: string) {
  return value.length <= CALLER_CONTEXT_LIMIT
    ? value
    : value.slice(0, CALLER_CONTEXT_LIMIT)
}

/** Drop the block when the lookup fails or outlives its deadline. */
export async function assembleCallerContext(
  lookup: (deadline: number) => Promise<CallerLookup>,
  options?: {
    timeoutMs?: number
    now?: () => number
    onDiagnostic?: (reason: "timeout" | "failed") => void
  }
): Promise<string | undefined> {
  const now = options?.now ?? Date.now
  const deadline = now() + (options?.timeoutMs ?? CALLER_CONTEXT_TIMEOUT_MS)
  try {
    const result = await lookup(deadline)
    if (callerContextPastDeadline(deadline, now)) {
      options?.onDiagnostic?.("timeout")
      return undefined
    }
    return formatCallerContext(result)
  } catch (error) {
    options?.onDiagnostic?.(
      error instanceof CallerContextTimeout ? "timeout" : "failed"
    )
    return undefined
  }
}
