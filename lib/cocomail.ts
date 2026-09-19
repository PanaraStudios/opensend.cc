const COCOMAIL_BASE_URL = "https://cocomail.cc/v1"

export const WAITLIST_TAG = "opensend.cc"

type CocomailErrorBody = {
  error?: {
    code?: string
    message?: string
  }
}

export type CocomailContact = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  name: string
  tags: string[]
  status: string
  source: string
  createdAt: number
  updatedAt: number
}

export type CreateContactResult =
  | { ok: true; created: true; contact: CocomailContact }
  | { ok: true; created: false; reason: "exists" }
  | {
      ok: false
      reason:
        "suppressed" | "invalid" | "unauthorized" | "rate_limited" | "error"
      message: string
    }

function apiKey(): string | undefined {
  return process.env.NEXT_COCOMAIL_API_KEY?.trim() || undefined
}

export type MailAttachment = {
  filename: string
  /** Base64. */
  content: string
  contentType: string
}

export type MailInput = {
  to: string
  from: string
  replyTo: string
  subject: string
  text: string
  attachments?: MailAttachment[]
}

export type SendMailResult = { ok: true } | { ok: false; message: string }

export async function sendCocomailEmail(
  input: MailInput
): Promise<SendMailResult> {
  const key = apiKey()
  if (!key) return { ok: false, message: "NEXT_COCOMAIL_API_KEY is not set" }
  try {
    const response = await fetch(`${COCOMAIL_BASE_URL}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      return { ok: false, message: `Cocomail ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    console.error("Cocomail send request failed", error)
    return { ok: false, message: "Cocomail request failed." }
  }
}

async function findContactByEmail(
  key: string,
  email: string
): Promise<CocomailContact | null> {
  const response = await fetch(
    `${COCOMAIL_BASE_URL}/contacts?search=${encodeURIComponent(email)}&limit=10`,
    {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    }
  )
  if (!response.ok) return null

  const body = (await response.json()) as { data?: CocomailContact[] }
  const matches = body.data ?? []
  return (
    matches.find(
      (contact) => contact.email.toLowerCase() === email.toLowerCase()
    ) ?? null
  )
}

async function ensureTags(
  key: string,
  contact: CocomailContact,
  tags: string[]
): Promise<void> {
  const merged = Array.from(new Set([...contact.tags, ...tags]))
  if (merged.length === contact.tags.length) return

  const response = await fetch(`${COCOMAIL_BASE_URL}/contacts/${contact.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tags: merged }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    console.error("Cocomail failed to tag an existing contact", {
      status: response.status,
    })
  }
}

function readError(body: unknown): { code: string; message: string } {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as CocomailErrorBody).error === "object" &&
    (body as CocomailErrorBody).error !== null
  ) {
    const error = (body as CocomailErrorBody).error
    return {
      code: typeof error?.code === "string" ? error.code : "error",
      message:
        typeof error?.message === "string"
          ? error.message
          : "Could not join the waitlist.",
    }
  }

  return { code: "error", message: "Could not join the waitlist." }
}

export async function createCocomailContact(input: {
  email: string
  firstName?: string
  lastName?: string
  tags?: string[]
}): Promise<CreateContactResult> {
  const key = apiKey()
  if (!key) {
    console.error("NEXT_COCOMAIL_API_KEY is not set")
    return {
      ok: false,
      reason: "error",
      message: "Waitlist is temporarily unavailable.",
    }
  }

  const tags = input.tags ?? [WAITLIST_TAG]

  let response: Response
  try {
    response = await fetch(`${COCOMAIL_BASE_URL}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        tags,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.error("Cocomail request failed", error)
    return {
      ok: false,
      reason: "error",
      message: "Could not join the waitlist. Try again in a moment.",
    }
  }

  if (response.status === 201) {
    const contact = (await response.json()) as CocomailContact
    return { ok: true, created: true, contact }
  }

  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }

  const { code, message } = readError(parsed)

  if (response.status === 409 || code === "exists") {
    try {
      const existing = await findContactByEmail(key, input.email)
      if (existing) {
        await ensureTags(key, existing, tags)
      }
    } catch (error) {
      console.error("Cocomail failed to tag an existing contact", error)
    }
    return { ok: true, created: false, reason: "exists" }
  }

  if (response.status === 422 && code === "suppressed") {
    return { ok: false, reason: "suppressed", message }
  }

  if (response.status === 400 || code === "invalid_request") {
    return { ok: false, reason: "invalid", message }
  }

  if (response.status === 401 || code === "unauthorized") {
    console.error("Cocomail rejected the API key")
    return {
      ok: false,
      reason: "unauthorized",
      message: "Waitlist is temporarily unavailable.",
    }
  }

  if (response.status === 429 || code === "rate_limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many attempts. Try again in a minute.",
    }
  }

  console.error("Cocomail create contact failed", {
    status: response.status,
    code,
  })
  return {
    ok: false,
    reason: "error",
    message: "Could not join the waitlist. Try again in a moment.",
  }
}
