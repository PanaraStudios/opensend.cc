import { v } from "convex/values"
export const prompt = v.union(
  v.object({ kind: v.literal("audio"), fileId: v.id("storedFiles") }),
  v.object({
    kind: v.literal("tts"),
    text: v.string(),
    voice: v.optional(v.string()),
  })
)
export const action = v.union(
  v.object({ kind: v.literal("submenu"), menuId: v.string() }),
  v.object({ kind: v.literal("agents") }),
  v.object({ kind: v.literal("bot"), botId: v.id("voiceBots") }),
  v.object({ kind: v.literal("voicemail") }),
  v.object({ kind: v.literal("playAndHangup"), prompt }),
  v.object({
    kind: v.literal("webhook"),
    url: v.string(),
    secretId: v.optional(v.id("webhooks")),
  }),
  v.object({ kind: v.literal("hangup") })
)
export const menu = v.object({
  id: v.string(),
  name: v.string(),
  prompt,
  invalidPrompt: v.optional(prompt),
  timeoutSeconds: v.number(),
  retries: v.number(),
  maxDigits: v.number(),
  options: v.record(v.string(), action),
  noInputAction: action,
  failureAction: action,
})
export const definition = v.object({
  name: v.string(),
  language: v.string(),
  entryMenuId: v.string(),
  menus: v.array(menu),
  promptVoice: v.optional(
    v.object({
      provider: v.union(v.literal("elevenlabs"), v.literal("sarvam")),
      voice: v.string(),
      language: v.string(),
      credentialId: v.id("voiceProviders"),
    })
  ),
  businessHours: v.optional(
    v.object({
      status: v.union(v.literal("ENABLED"), v.literal("DISABLED")),
      timezone_id: v.optional(v.string()),
      weekly_operating_hours: v.optional(
        v.array(
          v.object({
            day_of_week: v.union(
              ...(
                [
                  "MONDAY",
                  "TUESDAY",
                  "WEDNESDAY",
                  "THURSDAY",
                  "FRIDAY",
                  "SATURDAY",
                  "SUNDAY",
                ] as const
              ).map((d) => v.literal(d))
            ),
            open_time: v.string(),
            close_time: v.string(),
          })
        )
      ),
      holiday_schedule: v.optional(
        v.array(
          v.object({
            date: v.string(),
            start_time: v.string(),
            end_time: v.string(),
          })
        )
      ),
      closedAction: action,
    })
  ),
})
export const pathEntry = v.object({
  menuId: v.string(),
  digits: v.string(),
  action,
  at: v.number(),
})
export { callingRouting as routing } from "../calling/routingValue"
