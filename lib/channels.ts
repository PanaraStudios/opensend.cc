export const CHANNEL_IDS = [
  "email",
  "whatsapp",
  "messenger",
  "instagram",
] as const
export type Channel = (typeof CHANNEL_IDS)[number]
export type MessagingChannel = Exclude<Channel, "email">
/** Legacy resource rows without a channel are email resources. */
export function rowChannel<T extends string>(row: {
  channel?: T
}): T | "email" {
  return row.channel ?? "email"
}
export const PAGE_CHANNELS = ["messenger", "instagram"] as const
export type PageChannel = (typeof PAGE_CHANNELS)[number]

export const CHANNEL_MESSAGE_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "read",
  "played",
  "failed",
  "received",
] as const

type ChannelDefinition = {
  label: string
  sendStep?: `send_${MessagingChannel}`
  accountNoun: string
  handleLabel: string
  idLabel: string
  resource: string
  idParam: string
  supports: { logs: boolean; registration: boolean; delivered: boolean }
  /** Stored account fields exposed by the existing REST contract. */
  accountFields: Record<string, string>
  accountDefaults: Record<string, unknown>
}
export const CHANNELS = {
  email: {
    label: "Email",
    accountNoun: "Domain",
    handleLabel: "Domain",
    idLabel: "Domain ID",
    resource: "domains",
    idParam: "domain_id",
    supports: { logs: true, registration: false, delivered: true },
    accountFields: {},
    accountDefaults: {},
  },
  whatsapp: {
    sendStep: "send_whatsapp",
    label: "WhatsApp",
    accountNoun: "Number",
    handleLabel: "Number",
    idLabel: "Phone number ID",
    resource: "phone-numbers",
    idParam: "phone_number_id",
    supports: { logs: true, registration: true, delivered: true },
    accountFields: {
      phone_number_id: "externalId",
      display_phone_number: "handle",
      verified_name: "displayName",
      quality: "quality",
      throughput: "throughputMps",
      messaging_limit: "messagingLimit",
      waba_id: "wabaId",
    },
    accountDefaults: {
      quality: "unknown",
      messaging_limit: null,
      waba_id: null,
    },
  },
  messenger: {
    sendStep: "send_messenger",
    label: "Messenger",
    accountNoun: "Page",
    handleLabel: "Handle",
    idLabel: "Page ID",
    resource: "pages",
    idParam: "page_id",
    supports: { logs: true, registration: false, delivered: true },
    accountFields: {
      channel: "channel",
      external_id: "externalId",
      page_id: "pageId",
      name: "displayName",
      handle: "handle",
    },
    accountDefaults: {},
  },
  instagram: {
    sendStep: "send_instagram",
    label: "Instagram",
    accountNoun: "Account",
    handleLabel: "Handle",
    idLabel: "Account ID",
    resource: "accounts",
    idParam: "account_id",
    supports: { logs: true, registration: false, delivered: false },
    accountFields: {
      channel: "channel",
      external_id: "externalId",
      page_id: "pageId",
      instagram_account_id: "externalId",
      name: "displayName",
      handle: "handle",
    },
    accountDefaults: {},
  },
} as const satisfies Record<Channel, ChannelDefinition>
export type LogChannel = {
  [C in Channel]: (typeof CHANNELS)[C]["supports"]["logs"] extends true
    ? C
    : never
}[Channel]
export function isPageChannel(channel: string): channel is PageChannel {
  return PAGE_CHANNELS.some((value) => value === channel)
}

/** Messaging steps share a config and pipeline; their channel lives in the registry. */
export const MESSAGING_CHANNELS = CHANNEL_IDS.filter(
  (channel): channel is MessagingChannel => channel !== "email"
)
export const CHANNEL_SEND_STEPS = MESSAGING_CHANNELS.map(
  (channel) => CHANNELS[channel].sendStep
)
export type ChannelSendStepType = (typeof CHANNEL_SEND_STEPS)[number]
export function isChannelSendStep(type: string): type is ChannelSendStepType {
  return CHANNEL_SEND_STEPS.some((step) => step === type)
}
export function channelForSendStep(
  type: ChannelSendStepType
): MessagingChannel {
  return MESSAGING_CHANNELS.find(
    (channel) => CHANNELS[channel].sendStep === type
  )!
}

/** An unrecognized list filter (including “all”) means every channel. */
export function logChannel(value: string): Channel | undefined {
  return CHANNEL_IDS.find((channel) => channel === value)
}
