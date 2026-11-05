import type { MessagingChannel } from "../dashboard/types"

/** Graph returns a bare Instagram username; display it as a channel handle. */
export function channelHandle(channel: MessagingChannel, handle: string) {
  return channel === "instagram" && handle && !handle.startsWith("@")
    ? `@${handle}`
    : handle
}
