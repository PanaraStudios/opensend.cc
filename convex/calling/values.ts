import { pathEntry, action as ivrAction } from "../ivr/validators"
import { v } from "convex/values"
import {
  callMedia,
  callSession,
  callStatus,
  handlingMode,
} from "../tables/calling"
const nullableString = v.union(v.string(), v.null())
const nullableNumber = v.union(v.number(), v.null())
const media = v.union(
  v.null(),
  v.object({ ...callMedia.fields, download_url: nullableString })
)
export const callPayloadFields = {
  object: v.literal("whatsapp_call"),
  id: v.id("calls"),
  account_id: v.id("channelAccounts"),
  wacid: nullableString,
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  status: callStatus,
  handling_mode: handlingMode,
  user_id: nullableString,
  from: nullableString,
  to: nullableString,
  contact_id: v.union(v.id("contacts"), v.null()),
  conversation_id: v.union(v.id("conversations"), v.null()),
  created_at: v.string(),
  observed_at: v.number(),
  connected_at: nullableNumber,
  ended_at: nullableNumber,
  duration: nullableNumber,
  biz_opaque_callback_data: nullableString,
  cta_payload: nullableString,
  deeplink_payload: nullableString,
  session: v.union(v.null(), callSession),
  recording: media,
  transcription: media,
  error: nullableString,
  error_code: nullableNumber,
  assigned_agent: nullableString,
  ivr_id: v.union(v.id("ivrs"), v.null()),
  ivr_path: v.array(pathEntry),
  ivr_outcome: v.union(ivrAction, v.null()),
}
export const callPayloadValue = v.object(callPayloadFields)
export const callPageValue = v.object({
  object: v.literal("list"),
  has_more: v.boolean(),
  data: v.array(callPayloadValue),
})
export const callDetailValue = v.object({
  ...callPayloadFields,
  events: v.array(
    v.object({
      event: v.string(),
      at: v.number(),
      details: v.record(v.string(), v.any()),
    })
  ),
})
