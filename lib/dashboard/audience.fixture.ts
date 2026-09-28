import type { Contact, SentEmail, Segment } from "./types"

export const FIXTURE_NOW = Date.parse("2026-09-13T12:00:00.000Z")
export const CONTACTS: Contact[] = [
  "margaret@hamilton.space",
  "alan@bletchley.uk",
  "unsubscribed@example.com",
].map((email, index) => ({
  id: `contact_${index}`,
  email,
  firstName: "",
  lastName: "",
  createdAt: FIXTURE_NOW,
  unsubscribed: index === 2,
  segmentIds: index === 1 ? [] : ["seg_newsletter"],
  topics: [],
  properties: {},
}))
export const SEGMENTS: Segment[] = [
  { id: "seg_newsletter", name: "Newsletter", createdAt: FIXTURE_NOW },
]
export const EMAILS: SentEmail[] = [
  {
    id: "email_1",
    from: "hello@example.com",
    to: "margaret@hamilton.space",
    subject: "Hello",
    html: "<p>Hello</p>",
    text: "Hello",
    scheduledAt: null,
    events: [],
    status: "clicked",
    createdAt: FIXTURE_NOW,
    broadcastId: "brd_launch",
  },
  {
    id: "email_2",
    from: "hello@example.org",
    to: "gone@example.invalid",
    subject: "Hello",
    html: "<p>Hello</p>",
    text: "Hello",
    scheduledAt: null,
    events: [],
    status: "bounced",
    createdAt: FIXTURE_NOW - 86400000,
    broadcastId: "brd_launch",
  },
]
