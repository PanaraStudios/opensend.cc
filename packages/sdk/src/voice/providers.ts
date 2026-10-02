import type { Opensend } from "../resend"
import type { ChannelPage, ChannelRequestOptions } from "../channels/interfaces"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import type {
  VoiceProviderCredential,
  CreateVoiceProvider,
  ElevenLabsVoiceList,
} from "./interfaces"
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
  listVoices(options?: { credentialId?: string; refresh?: boolean }) {
    const query = new URLSearchParams()
    if (options?.credentialId) query.set("credential_id", options.credentialId)
    if (options?.refresh) query.set("refresh", "true")
    const search = query.toString()
    const prefix = search ? "?" + search : ""
    return this.resend.get<ElevenLabsVoiceList>(
      `/voice-providers/elevenlabs/voices${prefix}`
    )
  }
}
