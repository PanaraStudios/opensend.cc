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

type ChannelDefinition = {
  label: string
  accountNoun: string
  handleLabel: string
  idLabel: string
  resource: string
  idParam: string
  supports: { logs: boolean; registration: boolean }
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
    supports: { logs: true, registration: false },
    accountFields: {},
    accountDefaults: {},
  },
  whatsapp: {
    label: "WhatsApp",
    accountNoun: "Number",
    handleLabel: "Number",
    idLabel: "Phone number ID",
    resource: "phone-numbers",
    idParam: "phone_number_id",
    supports: { logs: true, registration: true },
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
    label: "Messenger",
    accountNoun: "Page",
    handleLabel: "Handle",
    idLabel: "Page ID",
    resource: "pages",
    idParam: "page_id",
    supports: { logs: false, registration: false },
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
    label: "Instagram",
    accountNoun: "Account",
    handleLabel: "Handle",
    idLabel: "Account ID",
    resource: "accounts",
    idParam: "account_id",
    supports: { logs: false, registration: false },
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
