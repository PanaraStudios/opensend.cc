"use server"

import { createCocomailContact, WAITLIST_TAG } from "@/lib/cocomail"

export type JoinWaitlistResult =
  | { ok: true; alreadyJoined: boolean }
  | { ok: false; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function messageFor(result: Awaited<ReturnType<typeof createCocomailContact>>) {
  if (result.ok) return null
  if (result.reason === "suppressed") {
    return "This address can't be added. Write hello@opensend.cc if that's a surprise."
  }
  if (result.reason === "invalid") {
    return "Enter a valid email address."
  }
  return result.message
}

export async function joinWaitlist(email: string): Promise<JoinWaitlistResult> {
  const address = email.trim().toLowerCase()
  if (!EMAIL_RE.test(address)) {
    return { ok: false, message: "Enter a valid email address." }
  }

  const result = await createCocomailContact({
    email: address,
    tags: [WAITLIST_TAG],
  })

  if (result.ok) {
    return { ok: true, alreadyJoined: !result.created }
  }

  return { ok: false, message: messageFor(result) ?? result.message }
}
