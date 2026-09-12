import { parse } from "convex-helpers/validators"
import type { GenericValidator, Infer } from "convex/values"

export const assertExhaustive = (value: never): never => {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`)
}

/**
 * Attempt to parse a value with a Convex validator, returning a result object
 * instead of throwing. Unknown fields are stripped from the parsed value.
 */
export function attemptToParse<T extends GenericValidator>(
  validator: T,
  value: unknown
): { kind: "success"; data: Infer<T> } | { kind: "error"; error: unknown } {
  try {
    return { kind: "success", data: parse(validator, value) as Infer<T> }
  } catch (error) {
    return { kind: "error", error }
  }
}

/**
 * Amazon SES mailbox simulator addresses. Labels are supported by SES
 * (e.g. `bounce+label1@simulator.amazonses.com`); we intentionally only allow
 * `[a-zA-Z0-9_-]` in labels to keep the pattern simple and predictable.
 *
 * https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html
 */
const SES_SIMULATOR_ADDRESS_REGEX =
  /^(success|bounce|ooto|complaint|suppressionlist)(\+[a-zA-Z0-9_-]*)?@simulator\.amazonses\.com$/i

/** Check whether an address targets the Amazon SES mailbox simulator. */
export function isSesSimulatorAddress(email: string): boolean {
  // Do not accept a list disguised as a display name ending in a simulator.
  return (
    !/[\r\n,;]/.test(email) &&
    SES_SIMULATOR_ADDRESS_REGEX.test(extractAddress(email))
  )
}

/**
 * Extract the bare address from an RFC 5322 mailbox such as
 * `"Sender Name" <sender@example.com>`; returns the input unchanged otherwise.
 */
export function extractAddress(mailbox: string): string {
  const match = /^(?:"[^"\r\n]*"|[^<>"\r\n]*)\s*<([^<>]+)>\s*$/.exec(
    mailbox.trim()
  )
  return (match?.[1] ?? mailbox).trim()
}

/**
 * Deterministic JSON serialization (object keys sorted) so that two values
 * with the same content compare equal regardless of key order.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k]
          return acc
        }, {})
    }
    return val
  })
}

export function isDeepEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

/** Split an array into chunks of at most `size` elements. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1")
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value : [value]
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export function assertTuning(config: {
  maxSendRate: number
  retryAttempts: number
  initialBackoffMs: number
}) {
  if (!Number.isFinite(config.maxSendRate) || config.maxSendRate < 1) {
    throw new Error(
      "maxSendRate must be finite and at least 1 recipient per second"
    )
  }
  if (
    !Number.isSafeInteger(config.retryAttempts) ||
    config.retryAttempts < 1 ||
    config.retryAttempts > 20
  ) {
    throw new Error("retryAttempts must be an integer between 1 and 20")
  }
  if (
    !Number.isFinite(config.initialBackoffMs) ||
    config.initialBackoffMs < 0 ||
    config.initialBackoffMs > 86_400_000
  ) {
    throw new Error(
      "initialBackoffMs must be finite and between 0 and 86400000"
    )
  }
}

export function assertRecipients(email: {
  from: string
  to: string[]
  cc?: string[]
  bcc?: string[]
}) {
  const recipients = [...email.to, ...(email.cc ?? []), ...(email.bcc ?? [])]
  if (!recipients.length) throw new Error("At least one recipient is required")
  if (recipients.length > 50)
    throw new Error("SES allows at most 50 recipients across to, cc, and bcc")
  for (const mailbox of [email.from, ...recipients]) {
    if (
      /[\r\n]/.test(mailbox) ||
      !/^[^\s<>@,;]+@[^\s<>@,;]+$/.test(extractAddress(mailbox))
    ) {
      throw new Error("Each address must contain exactly one valid mailbox")
    }
  }
}

export function assertSimulatorRecipients(email: {
  to: string[]
  cc?: string[]
  bcc?: string[]
}) {
  for (const recipient of [
    ...email.to,
    ...(email.cc ?? []),
    ...(email.bcc ?? []),
  ]) {
    if (!isSesSimulatorAddress(recipient)) {
      throw new Error(
        "Test mode is enabled: all recipients must be Amazon SES mailbox simulator addresses"
      )
    }
  }
}
