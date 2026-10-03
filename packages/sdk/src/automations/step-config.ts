import { isChannelSendStep, CHANNEL_STEP_API_FIELDS } from "./channels"
import type { AutomationStepType } from "./interfaces/automation-step.interface"

/** Inverse of parseStepConfig: REST response config to SDK workflow config. */
export function parseApiStepConfig(step: {
  type: AutomationStepType
  config: Record<string, unknown>
}): Record<string, unknown> {
  const fields: Partial<Record<AutomationStepType, Record<string, string>>> = {
    trigger: { event_name: "eventName" },
    place_call: {
      account_id: "accountId",
      request_permission: "requestPermission",
    },
    send_email: { reply_to: "replyTo" },
    wait_for_event: { event_name: "eventName", filter_rule: "filterRule" },
    contact_update: { first_name: "firstName", last_name: "lastName" },
    add_to_segment: { segment_id: "segmentId" },
  }
  const names: Record<string, string> = isChannelSendStep(step.type)
    ? CHANNEL_STEP_API_FIELDS
    : (fields[step.type] ?? {})
  return Object.fromEntries(
    Object.entries(step.config).map(([key, value]) => [
      names[key] ?? key,
      value,
    ])
  )
}
