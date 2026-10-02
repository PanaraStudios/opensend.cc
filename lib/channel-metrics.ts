import { CHANNEL_MESSAGE_STATUSES } from "./channels"
import { rate } from "./dashboard/format"

export type MessageMetricStatus = (typeof CHANNEL_MESSAGE_STATUSES)[number]
export type MessageStatusCounts = Record<
  Exclude<MessageMetricStatus, "played">,
  number
> & { played?: number }
export type ChannelMetricCounts = Record<
  "sent" | "delivered" | "read" | "failed" | "received",
  number
>

export function emptyChannelCounts(): ChannelMetricCounts {
  return { sent: 0, delivered: 0, read: 0, failed: 0, received: 0 }
}

/** Aggregates store current status, so later receipts still count as sent. */
export function rollupChannelCounts(
  status: MessageStatusCounts
): ChannelMetricCounts {
  return {
    sent:
      status.queued +
      status.sent +
      status.delivered +
      status.read +
      (status.played ?? 0) +
      status.failed,
    delivered: status.delivered + status.read + (status.played ?? 0),
    read: status.read + (status.played ?? 0),
    failed: status.failed,
    received: status.received,
  }
}

export function sumChannelCounts(
  rows: readonly ChannelMetricCounts[]
): ChannelMetricCounts {
  return rows.reduce(
    (total, row) => ({
      sent: total.sent + row.sent,
      delivered: total.delivered + row.delivered,
      read: total.read + row.read,
      failed: total.failed + row.failed,
      received: total.received + row.received,
    }),
    emptyChannelCounts()
  )
}

/** Both rates use the outbound total, including queued and failed attempts. */
export function channelRates(counts: ChannelMetricCounts) {
  return {
    deliveryRate: rate(counts.delivered, counts.sent),
    readRate: rate(counts.read, counts.sent),
  }
}
