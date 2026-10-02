export const CHANNEL_SEND_STEPS = [
  "send_whatsapp",
  "send_messenger",
  "send_instagram",
] as const
export type ChannelSendStepType = (typeof CHANNEL_SEND_STEPS)[number]
export function isChannelSendStep(type: string): type is ChannelSendStepType {
  return CHANNEL_SEND_STEPS.some((step) => step === type)
}
export const CHANNEL_STEP_API_FIELDS = {
  account_id: "accountId",
  template_id: "templateId",
}

/** Legacy resource rows without a channel are email resources. */
export function rowChannel<T extends string>(row: {
  channel?: T
}): T | "email" {
  return row.channel ?? "email"
}
