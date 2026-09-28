import { searchNeedle, matchesNeedle } from "./search"

export const OPTION_LIMIT = 20

/** Rank bounded configuration rows: exact, prefix, then substring matches. */
export function matchingOptions<T>(
  rows: T[],
  search: string | undefined,
  fields: (row: T) => string[]
) {
  const needle = searchNeedle(search ?? "")
  if (!needle) return rows.slice(0, OPTION_LIMIT)
  const rank = (row: T) => {
    const values = fields(row).map((value) => value.toLowerCase())
    return values.includes(needle)
      ? 0
      : values.some((value) => value.startsWith(needle))
        ? 1
        : 2
  }
  return rows
    .filter((row) => matchesNeedle(needle, ...fields(row)))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, OPTION_LIMIT)
}

/** Reserve one of the twenty slots for a selection outside the matches. */
export function includeSelected<T>(
  rows: readonly T[],
  selected: T | null | undefined,
  key: (row: T) => string
): T[] {
  const page = rows.slice(0, OPTION_LIMIT)
  if (!selected || page.some((row) => key(row) === key(selected))) return page
  return [...page.slice(0, OPTION_LIMIT - 1), selected]
}
