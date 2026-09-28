import { isEmail } from "./format"
import type {
  Contact,
  ContactProperty,
  Topic,
  TopicSubscription,
} from "./types"

export const RESERVED_PROPERTY_KEYS = [
  "email",
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

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

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
export type ContactInput = { email: string } & Partial<ContactFields>

const MAX_EMAIL = 254
const MAX_VALUE = 1000

export function contactEmailError(email: string): string | null {
  return isEmail(email) && email.length <= MAX_EMAIL
    ? null
    : `${email || "An empty address"} is not a valid email address`
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
  { key: "first_name", name: "First name", type: "string" },
  { key: "last_name", name: "Last name", type: "string" },
  { key: "unsubscribed", name: "Unsubscribed", type: "boolean" },
] as const
