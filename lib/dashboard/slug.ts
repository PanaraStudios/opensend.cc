export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
}

/** The name's slug, numbered (`acme-2`) while another record holds it. */
export function uniqueSlug(
  name: string,
  existing: readonly string[],
  fallback: string
): string {
  const taken = new Set(existing)
  const base = slugify(name) || fallback
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}
