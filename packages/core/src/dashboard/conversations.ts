/* Rules the inbox shares with its backend: replying on an email thread,
   and WhatsApp's customer service window. */

/** "Re: " once, before the subject being answered. */
export function replySubject(subject: string | undefined): string {
  const text = subject?.trim() || "Your message"
  return /^re:/i.test(text) ? text : `Re: ${text}`
}

/** Threading headers answering a Message-ID, when the email had one.
    Mail clients thread on the bracketed form (RFC 5322 §3.6.4). */
export function replyHeaders(
  messageId: string | undefined
): { name: string; value: string }[] {
  const id = messageId?.trim()
  if (!id || !/^[\x21-\x7e]{1,900}$/.test(id)) return []
  const value = id.startsWith("<") ? id : `<${id}>`
  return [
    { name: "In-Reply-To", value },
    { name: "References", value },
  ]
}

/** Free-form replies are allowed until the window closes; email has none. */
export function canReply(
  conversation: { channel: string; windowExpiresAt?: number },
  now: number
): boolean {
  return (
    conversation.channel === "email" ||
    (conversation.windowExpiresAt ?? 0) > now
  )
}

/** "3h 12m" left in the window, or null once it has closed. */
export function windowLeft(
  windowExpiresAt: number | undefined,
  now: number
): string | null {
  const left = (windowExpiresAt ?? 0) - now
  if (left <= 0) return null
  const minutes = Math.ceil(left / 60_000)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`
}

/** The reply's sender: an address the email was sent to, on one of the
    team's sending domains, else the first sender offered. */
export function replySender(
  receivedTo: readonly string[],
  senders: readonly string[]
): string | undefined {
  const domainOf = (value: string) =>
    /@([^\s@<>]+)>?\s*$/.exec(value)?.[1]?.toLowerCase()
  for (const address of receivedTo) {
    const domain = domainOf(address)
    if (domain && senders.some((sender) => domainOf(sender) === domain))
      return address
  }
  return senders[0]
}
