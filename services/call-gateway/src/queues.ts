/** Operator-defined local VoIP queues, scoped to an organization. Queue creation
 * belongs to wave 8d; browser users cannot invent destinations. */
export function agentQueues(
  config: string | undefined,
  organizationId: string
): string[] {
  if (!config || !/^[a-zA-Z0-9_-]{1,80}$/.test(organizationId)) return []
  try {
    const map: unknown = JSON.parse(config)
    if (!map || typeof map !== "object" || Array.isArray(map)) return []
    const names = (map as Record<string, unknown>)[organizationId]
    if (!Array.isArray(names)) return []
    return [
      ...new Set(
        names.filter(
          (name): name is string =>
            typeof name === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(name)
        )
      ),
    ].slice(0, 100)
  } catch {
    return []
  }
}
