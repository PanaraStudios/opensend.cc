import type { Opensend } from "../resend"
import type { ChannelPage, ChannelRequestOptions } from "../channels/interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import type { VoiceProviderCredential, CreateVoiceProvider } from "./interfaces"
export class VoiceProviders {
  constructor(private readonly resend: Opensend) {}
  create(input: CreateVoiceProvider, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>("/voice-providers", input, options)
  }
  list(options: PaginationOptions = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options))
      if (value !== undefined) query.set(key, String(value))
    return this.resend.get<ChannelPage<VoiceProviderCredential>>(
      `/voice-providers?${query}`
    )
  }
  remove(id: string) {
    return this.resend.delete<{ id: string; deleted: boolean }>(
      `/voice-providers/${encodeURIComponent(id)}`
    )
  }
}
