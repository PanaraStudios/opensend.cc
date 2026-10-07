import { CHANNELS, type Channel } from "../channels"
import { contactIdentity } from "./contacts"
import { fromWaId } from "./phone"
import type { ThreadMessage } from "../messages/use-messages"

/** The same envelope labels for every message detail. */
export function messageEnvelope(input: {
  channel: Channel
  from: string
  to: string
  subject?: string
}) {
  return [
    { label: "Channel", value: CHANNELS[input.channel].label },
    { label: "Sender", value: input.from },
    { label: "Recipient", value: input.to },
    ...(input.subject !== undefined
      ? [{ label: "Subject", value: input.subject }]
      : []),
  ]
}

/** Prefer a customer's public name over Meta's scoped identifier. */
export function messageParty(input: {
  channel: Channel
  address: string
  profileName?: string
  username?: string
}) {
  if (input.channel === "whatsapp" && /^\+?[1-9]\d{7,14}$/.test(input.address))
    return fromWaId(input.address)
  if (input.channel === "email") return input.address
  return contactIdentity(
    {},
    {
      channel: input.channel,
      externalId: input.address,
      profileName: input.profileName,
      username: input.username,
    }
  ).label
}

/** Detail renders exactly this message, even when it is older than the thread page. */
export function detailThreadMessage(found: {
  message: {
    _id: string
    _creationTime: number
    direction: "inbound" | "outbound"
    status: string
    preview: string
  }
  normalized: Record<string, unknown>
  rendered?: ThreadMessage["rendered"]
  media: ThreadMessage["media"]
}): ThreadMessage {
  return {
    id: found.message._id,
    kind: "channel",
    direction: found.message.direction,
    at: found.message._creationTime,
    status: found.message.status,
    text: found.rendered?.body ?? found.message.preview,
    rendered: found.rendered,
    normalized: found.normalized as ThreadMessage["normalized"],
    media: found.media,
  }
}
