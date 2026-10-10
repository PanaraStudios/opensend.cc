import { normalizePhone } from "./phone"
import { CHANNELS, type MessagingChannel } from "../channels"
import { channelHandle } from "../meta/account-display"
import { isEmail } from "./format"
import type {
  Contact,
  ContactProperty,
  Topic,
  TopicSubscription,
} from "./types"

/** The public part of a contact's primary linked channel identity. */
export type ContactChannelIdentity = {
  channel: MessagingChannel
  externalId: string
  profileName?: string
  username?: string
  phone?: string
}
export function contactIdentity(
  contact: {
    firstName?: string
    lastName?: string
    email?: string | null
    phone?: string | null
    channelIdentity?: ContactChannelIdentity | null
  },
  channelIdentity = contact.channelIdentity
): {
  label: string
  secondary?: string
  kind: "email" | "phone" | "name" | "channel"
  channel?: MessagingChannel
} {
  const name = [contact.firstName?.trim(), contact.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
  const channel = channelIdentity?.channel
  const username = channelIdentity?.username?.trim()
  const handle = username ? channelHandle("instagram", username) : undefined
  const secondary =
    contact.email ||
    contact.phone ||
    handle ||
    (channel ? CHANNELS[channel].label : undefined)
  if (name) return { label: name, secondary, kind: "name", channel }
  if (contact.email)
    return { label: contact.email, secondary, kind: "email", channel }
  if (contact.phone)
    return { label: contact.phone, secondary, kind: "phone", channel }
  return {
    label:
      handle ||
      channelIdentity?.profileName?.trim() ||
      (channel ? `${CHANNELS[channel].label} user` : "Unknown contact"),
    secondary,
    kind: "channel",
    channel,
  }
}

export const RESERVED_PROPERTY_KEYS = [
  "email",
  "phone",
  "first_name",
  "last_name",
  "unsubscribed",
] as const

/** Slug rule shared by the property form, the store, and CSV mapping. */
export function normalizePropertyKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "_")
}

export function isValidPropertyKey(key: string): boolean {
  return /^[a-z][a-z0-9_]{0,49}$/.test(key)
}

export function isReservedPropertyKey(key: string): boolean {
  return (RESERVED_PROPERTY_KEYS as readonly string[]).includes(key)
}

/** Why `key` cannot name a new property, or null when it can. */
export function propertyKeyError(
  key: string,
  existing: readonly string[]
): string | null {
  if (!isValidPropertyKey(key))
    return "Use a lowercase key with letters, numbers, and underscores"
  if (isReservedPropertyKey(key) || existing.includes(key))
    return "That key already exists"
  return null
}

export { normalizeEmail } from "./format"

export function defaultTopicSubscription(
  topic: Pick<Topic, "defaultSubscription">
): TopicSubscription {
  return topic.defaultSubscription === "opt_out" ? "subscribed" : "unsubscribed"
}

/** The one rule for a contact's standing with a topic: their explicit
    choice, else the topic's default. Server and screens both use it. */
export function effectiveTopicSubscription(
  explicit: TopicSubscription | undefined,
  topic: Pick<Topic, "defaultSubscription">
): TopicSubscription {
  return explicit ?? defaultTopicSubscription(topic)
}

export function contactTopicStatus(
  contact: Pick<Contact, "topics">,
  topic: Topic
): TopicSubscription {
  return effectiveTopicSubscription(
    contact.topics.find((item) => item.topicId === topic.id)?.subscription,
    topic
  )
}

export type ContactFields = Pick<
  Contact,
  "firstName" | "lastName" | "unsubscribed" | "properties"
>
export type ContactIdentity = Pick<Contact, "email" | "phone">
export type ContactInput = ContactIdentity & Partial<ContactFields>

const MAX_EMAIL = 254
const MAX_VALUE = 1000

export function contactEmailError(email: string): string | null {
  return isEmail(email) && email.length <= MAX_EMAIL
    ? null
    : `${email || "An empty address"} is not a valid email address`
}

export function contactPhoneError(phone: string): string | null {
  return normalizePhone(phone)
    ? null
    : "Enter a phone number with + and 8–15 digits, including the country code"
}
export function contactInputError(
  input: ContactIdentity,
  options: { linkedChannel?: boolean } = {}
): { email?: string; phone?: string } | null {
  if (input.email?.trim()) {
    const error = contactEmailError(input.email.trim())
    if (error) return { email: error }
  }
  if (input.phone?.trim()) {
    const error = contactPhoneError(input.phone)
    if (error) return { phone: error }
  }
  if (!input.email?.trim() && !input.phone?.trim() && !options.linkedChannel)
    return { email: "An email or phone number is required" }
  return null
}

/** Why these values cannot be stored on a contact, or null. Property keys
    must be defined, and a number property holds a number. */
export function contactFieldsError(
  fields: Partial<ContactFields>,
  properties: readonly Pick<ContactProperty, "key" | "type">[]
): string | null {
  if (
    (fields.firstName?.length ?? 0) > MAX_VALUE ||
    (fields.lastName?.length ?? 0) > MAX_VALUE
  )
    return "Names are limited to 1000 characters"
  for (const [key, value] of Object.entries(fields.properties ?? {})) {
    const property = properties.find((item) => item.key === key)
    if (!property) return `Unknown property: ${key}`
    if (value.length > MAX_VALUE) return `${key} is limited to 1000 characters`
    if (property.type === "number" && value && !Number.isFinite(Number(value)))
      return `${key} must be a number`
  }
  return null
}

/** An upsert onto an existing contact: blank names and missing values keep
    what is stored, properties merge key by key. */
export function mergeContactFields(
  existing: ContactFields,
  input: Partial<ContactFields>
): ContactFields {
  return {
    firstName: input.firstName?.trim() || existing.firstName,
    lastName: input.lastName?.trim() || existing.lastName,
    unsubscribed: input.unsubscribed ?? existing.unsubscribed,
    properties: { ...existing.properties, ...(input.properties ?? {}) },
  }
}

export const DEFAULT_CONTACT_PROPERTIES = [
  { key: "email", name: "Email", type: "string" },
  { key: "phone", name: "Phone", type: "string" },
  { key: "first_name", name: "First name", type: "string" },
  { key: "last_name", name: "Last name", type: "string" },
  { key: "unsubscribed", name: "Unsubscribed", type: "boolean" },
] as const
