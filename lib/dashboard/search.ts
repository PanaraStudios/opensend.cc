/** Lowercased, trimmed search needle. Compute once per render, not per row. */
export function searchNeedle(query: string): string {
  return query.trim().toLowerCase()
}

/** True when any field contains the needle. An empty needle matches all. */
export function matchesNeedle(
  needle: string,
  ...fields: (string | null | undefined)[]
): boolean {
  if (!needle) return true
  return fields.some((field) => field?.toLowerCase().includes(needle))
}
