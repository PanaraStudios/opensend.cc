import { signToken, readToken } from "../tokens/signed"

/* A recipient's unsubscribe link carries who it is for, signed with the
   server secret so it cannot be forged or pointed at another contact. It
   holds ids only, never the address. Like Resend's, it never expires: a link
   in an old email must keep working. Rotating the secret retires every link
   already sent. */

export type UnsubscribeTarget = {
  organizationId: string
  contactId: string
  /** Set for a topic-scoped send: one-click then leaves only this topic. */
  topicId?: string
  broadcastId?: string
}

const CONTEXT = "opensend:unsubscribe:v1:"
export async function signUnsubscribeToken(
  target: UnsubscribeTarget,
  secret: string
) {
  const parts = [target.organizationId, target.contactId, target.topicId ?? ""]
  if (target.broadcastId) parts.push(target.broadcastId)
  if (parts.some((part) => part.includes(".")) || !parts[0] || !parts[1])
    throw new Error("Invalid unsubscribe target")
  const payload = parts.join(".")
  return signToken(payload, CONTEXT, secret)
}

/** The link's target, or null for anything this server did not sign. */
export async function readUnsubscribeToken(
  token: string,
  secret: string
): Promise<UnsubscribeTarget | null> {
  const payload = await readToken(token, CONTEXT, secret)
  if (!payload) return null
  const [organizationId, contactId, topicId, broadcastId] = payload.split(".")
  return {
    organizationId,
    contactId,
    ...(topicId ? { topicId } : {}),
    ...(broadcastId ? { broadcastId } : {}),
  }
}

/** RFC 2369 and RFC 8058 headers: mailbox providers show their own
    unsubscribe button and POST `List-Unsubscribe=One-Click` to the URL. */
export function listUnsubscribeHeaders(oneClickUrl: string) {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  }
}
