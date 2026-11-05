/** Tolerant wire parsing: missing or malformed fields retain their fallbacks. */
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
export const string = (value: unknown) =>
  typeof value === "string" ? value : ""
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : []
export const oneOf = <T extends string>(
  value: unknown,
  values: readonly T[]
): T | undefined => values.find((candidate) => candidate === value)
