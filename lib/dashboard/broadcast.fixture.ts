import type { Broadcast } from "./types"
import { emptyBroadcastStats } from "./broadcast"
export const BROADCAST_FIXTURE: Broadcast = {
  id: "brd_launch",
  name: "Launch week",
  subject: "Launch week is live",
  preview: "What shipped this week",
  html: "<h1>Launch week</h1>",
  status: "sent",
  segmentId: "seg_newsletter",
  topicId: "top_product",
  createdAt: 1,
  updatedAt: 2,
  scheduledAt: null,
  sentAt: 2,
  stats: emptyBroadcastStats(),
}
