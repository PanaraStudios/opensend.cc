import type { Opensend } from "../../resend"
import type {
  ChannelPage,
  ChannelRequestOptions,
} from "../../channels/interfaces"
import type {
  ConnectWhatsAppCall,
  AcceptWhatsAppCall,
  WhatsAppCall,
  WhatsAppCallDetail,
  ListWhatsAppCalls,
} from "./interfaces"
export class WhatsAppCalls {
  constructor(private readonly resend: Opensend) {}
  list(options: ListWhatsAppCalls = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options))
      if (value !== undefined)
        query.set(
          key === "phoneNumberId" ? "phone_number_id" : key,
          String(value)
        )
    return this.resend.get<ChannelPage<WhatsAppCall>>(
      `/whatsapp/calls?${query}`
    )
  }
  get(id: string) {
    return this.resend.get<WhatsAppCallDetail>(
      `/whatsapp/calls/${encodeURIComponent(id)}`
    )
  }
  connect(input: ConnectWhatsAppCall, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>("/whatsapp/calls", input, options)
  }
  preAccept(
    id: string,
    input: AcceptWhatsAppCall = {},
    options?: ChannelRequestOptions
  ) {
    return this.resend.post<{ id: string; success: boolean }>(
      `/whatsapp/calls/${encodeURIComponent(id)}/pre_accept`,
      input,
      options
    )
  }
  accept(
    id: string,
    input: AcceptWhatsAppCall = {},
    options?: ChannelRequestOptions
  ) {
    return this.resend.post<{ id: string; success: boolean }>(
      `/whatsapp/calls/${encodeURIComponent(id)}/accept`,
      input,
      options
    )
  }
  reject(id: string, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string; success: boolean }>(
      `/whatsapp/calls/${encodeURIComponent(id)}/reject`,
      {},
      options
    )
  }
  terminate(id: string, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string; success: boolean }>(
      `/whatsapp/calls/${encodeURIComponent(id)}/terminate`,
      {},
      options
    )
  }
}
