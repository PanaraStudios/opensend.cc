"use node"
/* Domain Connect: the DNS provider opens its own page with our records
   filled in, and the user confirms them there. No provider API or token is
   involved. Spec: https://github.com/Domain-Connect/spec
   Template: domain-connect/opensend.cc.ses.json at the repository root. */
import { createSign } from "node:crypto"
import { Resolver } from "node:dns/promises"
import { v, ConvexError, type Infer } from "convex/values"
import { action, env } from "../_generated/server"
import { internal } from "../_generated/api"
import type { Doc } from "../_generated/dataModel"
import { zoneCandidates } from "./dns"
import type { domainConnectValue } from "./contracts"

export const PROVIDER_ID = "opensend.cc"
export const SERVICE_ID = "ses"
type Settings = Infer<typeof domainConnectValue>
const TIMEOUT = 5000

/** The `_domainconnect` value is a public host, optionally with a path. An IP
    literal or single-label name would point our fetch at a private network. */
const PREFIX =
  /^(?!(\d+\.){3}\d+(\/|$))([a-z0-9-]+\.)+[a-z]{2,}(\/[\w.~-]+)*\/?$/i
/** An https URL with no trailing slash, or undefined. */
function httpsUrl(value: unknown) {
  if (typeof value !== "string") return undefined
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      ? `${url.origin}${url.pathname}`.replace(/\/$/, "")
      : undefined
  } catch {
    return undefined
  }
}
const get = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(TIMEOUT), redirect: "error" })

/** The domain's DNS provider, when it speaks Domain Connect and applies our
    template. Undefined otherwise: the records are then added by hand. */
export async function discover(
  name: string,
  resolver: Pick<Resolver, "resolveTxt"> = new Resolver({
    timeout: 2000,
    tries: 1,
  })
): Promise<Settings | undefined> {
  for (const zone of zoneCandidates(name)) {
    const prefix = await resolver
      .resolveTxt(`_domainconnect.${zone}`)
      .then((answers) =>
        answers.map((parts) => parts.join("")).find((v) => PREFIX.test(v))
      )
      .catch(() => undefined)
    if (!prefix) continue
    try {
      const response = await get(
        `https://${prefix.replace(/\/$/, "")}/v2/${zone}/settings`
      )
      if (!response.ok) return undefined
      const settings = (await response.json()) as Record<string, unknown>
      const urlSyncUX = httpsUrl(settings.urlSyncUX)
      const urlAPI = httpsUrl(settings.urlAPI)
      const providerName =
        typeof settings.providerDisplayName === "string"
          ? settings.providerDisplayName
          : settings.providerName
      if (!urlSyncUX || !urlAPI || typeof providerName !== "string")
        return undefined
      // 200 means the provider has onboarded our template; 404 means not.
      const template = await get(
        `${urlAPI}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${SERVICE_ID}`
      )
      if (!template.ok) return undefined
      const size = (value: unknown) =>
        typeof value === "number" && value > 0 ? value : undefined
      return {
        zone,
        providerName: providerName.slice(0, 64),
        urlSyncUX,
        width: size(settings.width),
        height: size(settings.height),
      }
    } catch {
      return undefined
    }
  }
  return undefined
}

/** The template's variables and the groups of records still missing. */
export function templateParams(domain: Doc<"domains">, zone: string) {
  const dkim = domain.records.filter((record) => record.kind === "DKIM")
  if (dkim.length !== 3)
    throw new ConvexError("SES has not issued this domain's DKIM keys yet")
  const missing = (...kinds: Doc<"domains">["records"][number]["kind"][]) =>
    domain.records.some(
      (record) => kinds.includes(record.kind) && record.status !== "verified"
    )
  const groups = [
    missing("DKIM", "MX", "SPF") && "sending",
    // Only when no DMARC policy exists: the template would replace one.
    domain.records.some(
      (record) => record.kind === "DMARC" && record.status === "pending"
    ) && "dmarc",
    missing("Receiving") && "receiving",
  ].filter((group) => typeof group === "string")
  if (!groups.length)
    throw new ConvexError("Every DNS record is already in place")
  const host =
    domain.name === zone ? "" : domain.name.slice(0, -(zone.length + 1))
  return {
    domain: zone,
    ...(host ? { host } : {}),
    dkim1: dkim[0].id,
    dkim2: dkim[1].id,
    dkim3: dkim[2].id,
    dkimzone: dkim[0].value.slice(dkim[0].id.length + 1),
    mailfrom: domain.customReturnPath,
    region: domain.region,
    groupId: groups.join(","),
  }
}

/** The template owner's signer. It signs only queries that point a domain
    at Amazon SES, so installations need no key of their own. */
const SIGNER = "https://opensend.cc/api/domain-connect/sign"

/** The apply URL's query string, each value encoded as the spec requires. */
export function templateQuery(params: Record<string, string>) {
  return Object.entries(params)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&")
}

/** RSA-SHA256 over the query string. The template declares
    `syncPubKeyDomain`, so providers accept only signed requests. An
    installation holding the template owner's key signs locally; any other
    asks the signer. */
export async function signature(
  query: string
): Promise<{ sig: string; key: string }> {
  const privateKey = env.DOMAIN_CONNECT_PRIVATE_KEY?.replace(/\\n/g, "\n")
  const key = env.DOMAIN_CONNECT_KEY
  if (privateKey && key)
    return {
      sig: createSign("RSA-SHA256").update(query).sign(privateKey, "base64"),
      key,
    }
  const response = await fetch(env.DOMAIN_CONNECT_SIGNER ?? SIGNER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch(() => null)
  const body = (await response?.json().catch(() => null)) as {
    sig?: unknown
    key?: unknown
  } | null
  if (
    !response?.ok ||
    typeof body?.sig !== "string" ||
    typeof body.key !== "string"
  )
    throw new ConvexError(
      "Automatic setup is unavailable right now. Add the records manually."
    )
  return { sig: body.sig, key: body.key }
}

/** The provider's apply URL, with `sig` and `key` after the signed query. */
export function applyUrl(
  urlSyncUX: string,
  query: string,
  { sig, key }: { sig: string; key: string }
) {
  return `${urlSyncUX}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${SERVICE_ID}/apply?${query}&sig=${encodeURIComponent(sig)}&key=${encodeURIComponent(key)}`
}

export const apply = action({
  args: { id: v.id("domains") },
  returns: v.string(),
  handler: async (ctx, { id }): Promise<string> => {
    const domain = await ctx.runQuery(internal.domains.writable, { id })
    if (!domain.domainConnect)
      throw new ConvexError(
        "Automatic setup isn't available for this domain's DNS provider"
      )
    const query = templateQuery(
      templateParams(domain, domain.domainConnect.zone)
    )
    return applyUrl(
      domain.domainConnect.urlSyncUX,
      query,
      await signature(query)
    )
  },
})
