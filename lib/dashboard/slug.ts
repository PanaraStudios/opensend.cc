export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

/** `base`, numbered (`acme-2`) while another record holds it. */
export function uniqueName(
  base: string,
  existing: readonly string[],
  separator = "-"
): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}${separator}${n}`)) n += 1
  return `${base}${separator}${n}`
}

/** The name's slug, numbered (`acme-2`) while another record holds it. */
export function uniqueSlug(
  name: string,
  existing: readonly string[],
  fallback: string
): string {
  return uniqueName(slugify(name) || fallback, existing)
}
