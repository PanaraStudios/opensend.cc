import { CHANNEL_IDS, type Channel } from "../channels"
export function defaultSendChannel(
  connected: readonly Channel[] | undefined,
  contact?: {
    email?: string | null
    phone?: string | null
    channelIdentity?: { channel: Channel } | null
  },
  manualChannel?: Channel
): Channel | undefined {
  if (connected === undefined) return manualChannel
  if (manualChannel && connected.includes(manualChannel)) return manualChannel
  const preferred =
    contact?.channelIdentity?.channel ??
    (contact?.email ? "email" : contact?.phone ? "whatsapp" : undefined)
  return preferred && connected.includes(preferred)
    ? preferred
    : CHANNEL_IDS.find((channel) => connected.includes(channel))
}
