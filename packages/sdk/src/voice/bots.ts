import type { Opensend } from "../resend"
import type { ChannelPage, ChannelRequestOptions } from "../channels/interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import type { VoiceBot, VoiceBotInput } from "./interfaces"
export class VoiceBots {
  constructor(private readonly resend: Opensend) {}
  create(input: VoiceBotInput, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>("/voice-bots", input, options)
  }
  list(options: PaginationOptions = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value))
    return this.resend.get<ChannelPage<VoiceBot>>(`/voice-bots?${query}`)
  }
  get(id: string) {
    return this.resend.get<VoiceBot>(`/voice-bots/${encodeURIComponent(id)}`)
  }
  update(id: string, input: Partial<VoiceBotInput>) {
    return this.resend.patch<{ id: string }>(
      `/voice-bots/${encodeURIComponent(id)}`,
      input
    )
  }
  remove(id: string) {
    return this.resend.delete<{ id: string; deleted: boolean }>(
      `/voice-bots/${encodeURIComponent(id)}`
    )
  }
}
