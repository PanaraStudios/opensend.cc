import { matchesNeedle } from "./search"
import type { Contact, Topic, TopicSubscription } from "./types"

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

export function defaultTopicSubscription(topic: Topic): TopicSubscription {
  return topic.defaultSubscription === "opt_out" ? "subscribed" : "unsubscribed"
}

export function contactTopicStatus(
  contact: Contact,
  topic: Topic
): TopicSubscription {
  const explicit = contact.topics.find((item) => item.topicId === topic.id)
  if (explicit) return explicit.subscription
  return defaultTopicSubscription(topic)
}

export function segmentContactCount(
  contacts: Contact[],
  segmentId: string
): number {
  return contacts.filter((contact) => contact.segmentIds.includes(segmentId))
    .length
}

/** One pass over contacts; use when counting for several segments. */
export function segmentContactCounts(contacts: Contact[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const contact of contacts) {
    for (const id of contact.segmentIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  return counts
}

export function contactMatches(contact: Contact, needle: string): boolean {
  return matchesNeedle(
    needle,
    contact.email,
    contact.firstName,
    contact.lastName
  )
}
