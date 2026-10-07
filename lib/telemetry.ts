/** Schema 1 is shared with the collector and the v1 backport. No product imports. */
export const TELEMETRY_DAY = 86_400_000
export const TELEMETRY_CAP = 10_000
export const TELEMETRY_COUNT_FIELDS = [
  "teams",
  "members",
  "domainsVerified",
  "emailsSent24h",
  "emailsReceived24h",
  "broadcasts30d",
  "automationsActive",
  "webhookEndpoints",
  "apiKeys",
  "apiRequests24h",
  "sdkRequests24h",
  "mcpRequests24h",
  "whatsappAccounts",
  "messengerPages",
  "instagramAccounts",
  "channelMessages24h",
  "calls30d",
  "ivrs",
  "voiceBots",
] as const
export type CountField = (typeof TELEMETRY_COUNT_FIELDS)[number]
export type UsageCounts = Record<CountField, number>
export type Band = "0" | "1-9" | "10-99" | "100-999" | "1k-9k" | "10k+"
export type Deployment = {
  backend: "self-hosted" | "convex-cloud"
  installMethod: "script" | "compose" | "source" | "unknown"
  arch: "amd64" | "arm64" | "unknown"
  calling: boolean
}
export function band(count: number): Band {
  if (!Number.isFinite(count) || count <= 0) return "0"
  if (count < 10) return "1-9"
  if (count < 100) return "10-99"
  if (count < 1000) return "100-999"
  if (count < TELEMETRY_CAP) return "1k-9k"
  return "10k+"
}
export function emptyUsage(): UsageCounts {
  return Object.fromEntries(
    TELEMETRY_COUNT_FIELDS.map((key) => [key, 0])
  ) as UsageCounts
}
export function telemetryEnabled(
  environment: string | undefined,
  preference?: boolean
) {
  return environment !== "0" && (preference ?? true)
}
export function callingEnabled(environment: string | undefined): boolean {
  return ["1", "yes", "true"].includes(environment?.trim().toLowerCase() ?? "")
}
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/

/** Normalize installer tags, then the image's release tag, to collector semver. */
export function normalizeTelemetryVersion(
  version?: string,
  bakedVersion?: string
): string {
  for (const candidate of [version, bakedVersion]) {
    const normalized = candidate?.replace(/^v/, "")
    if (normalized && normalized.length <= 128 && SEMVER.test(normalized))
      return normalized
  }
  return "0.0.0-unknown"
}
export function buildPayload(input: {
  installationId: string
  now: number
  installedAt: number
  version?: string
  bakedVersion?: string
  deployment: Deployment
  counts: UsageCounts
  sesProduction: boolean | null
  smtpUsed30d: boolean
  ssoEnabled: boolean
}) {
  // Explicit projection: even an input containing private data cannot add fields.
  return {
    schema: 1 as const,
    installationId: input.installationId,
    sentAt: new Date(input.now).toISOString(),
    version: normalizeTelemetryVersion(input.version, input.bakedVersion),
    deployment: {
      backend: input.deployment.backend,
      installMethod: input.deployment.installMethod,
      arch: input.deployment.arch,
      calling: input.deployment.calling,
    },
    installedDays: Math.max(
      0,
      Math.floor((input.now - input.installedAt) / TELEMETRY_DAY)
    ),
    usage: {
      ...(Object.fromEntries(
        TELEMETRY_COUNT_FIELDS.map((key) => [key, band(input.counts[key])])
      ) as Record<CountField, Band>),
      sesProduction: input.sesProduction,
      smtpUsed30d: input.smtpUsed30d,
      ssoEnabled: input.ssoEnabled,
    },
  }
}
export type TelemetryPayload = ReturnType<typeof buildPayload>
