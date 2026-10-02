/** System events available to webhook subscriptions and automation triggers. */
export const BOT_TOOLKIT_EVENTS = [
  { value: "call.data_collected", label: "Call data collected" },
] as const
export type CallDataCollected = {
  call_id: string
  contact_id: string | null
  collected: Record<
    string,
    { value: string | number | boolean; inferred: boolean }
  >
  missing: string[]
}
