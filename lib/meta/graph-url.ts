/** Meta's Graph API origin. */
export const GRAPH_ORIGIN = "https://graph.facebook.com"
/** The Graph API version a new Meta app starts on; the admin can change it. */
export const DEFAULT_GRAPH_VERSION = "v25.0"
const VERSION = /^v\d+\.\d+$/

export const isGraphVersion = (version: string) => VERSION.test(version)

export type GraphQuery = Record<string, string | number | boolean | undefined>

/** `https://graph.facebook.com/{version}/{path}?{query}`. `origin` replaces
    Meta's origin for a local fake Graph server in development and e2e. */
export function graphUrl(input: {
  version: string
  path: string
  query?: GraphQuery
  origin?: string
}): URL {
  if (!isGraphVersion(input.version))
    throw new Error(`Invalid Graph API version: ${input.version}`)
  const path = input.path.replace(/^\/+/, "")
  if (!path || path.split("/").some((part) => part === "." || part === ".."))
    throw new Error(`Invalid Graph API path: ${input.path}`)
  const url = new URL(`/${input.version}/${path}`, input.origin ?? GRAPH_ORIGIN)
  for (const [key, value] of Object.entries(input.query ?? {}))
    if (value !== undefined) url.searchParams.set(key, String(value))
  return url
}
