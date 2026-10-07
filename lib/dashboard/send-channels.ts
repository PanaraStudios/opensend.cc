import { CHANNEL_IDS, type Channel } from "../channels"
export function defaultSendChannel(
  connected: readonly Channel[],
  contact?: {
    email?: string | null
    phone?: string | null
    channelIdentity?: { channel: Channel } | null
  }
): Channel | undefined {
  const preferred =
    contact?.channelIdentity?.channel ??
    (contact?.email ? "email" : contact?.phone ? "whatsapp" : undefined)
  return preferred && connected.includes(preferred)
    ? preferred
    : CHANNEL_IDS.find((channel) => connected.includes(channel))
}
