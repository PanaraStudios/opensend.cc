/** Placeholder on every IVR read. It is not a credential. */
export const IVR_SIGNING_SECRET_PLACEHOLDER = "[redacted]"

/**
 * Create and rotate responses include the signing secret once.
 * Reads, updates, and renders send the placeholder instead.
 * Returns null when there is nothing to show.
 */
export function revealedIvrSigningSecret(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === IVR_SIGNING_SECRET_PLACEHOLDER) return null
  return value
}

/** Pull the one-time secret off a dashboard create or rotate result. */
export function revealedIvrSigningSecretFromResult(
  result: unknown
): string | null {
  if (!result || typeof result !== "object") return null
  if (!("webhook_signing_secret" in result)) return null
  return revealedIvrSigningSecret(result.webhook_signing_secret)
}
