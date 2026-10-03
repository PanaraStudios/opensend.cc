import type { Opensend } from "../../resend"
import type { ChannelRequestOptions } from "../../channels/interfaces"
import type {
  CallPermissionQuery,
  CallPermission,
  RequestCallPermission,
} from "./interfaces"
export class WhatsAppCallPermissions {
  constructor(private readonly resend: Opensend) {}
  getForContact(id: string, input: { from?: string } = {}) {
    const query = new URLSearchParams(input)
    return this.resend.get<CallPermission>(
      `/contacts/${encodeURIComponent(id)}/call-permission?${query}`
    )
  }
  requestForContact(
    id: string,
    input: {
      from?: string
      text?: string
      template?: RequestCallPermission["template"]
    } = {},
    options?: ChannelRequestOptions
  ) {
    return this.resend.post<{ id: string }>(
      `/contacts/${encodeURIComponent(id)}/call-permission`,
      input,
      options
    )
  }
  get(input: CallPermissionQuery) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, value)
    return this.resend.get<CallPermission>(
      `/whatsapp/call-permissions?${query}`
    )
  }
  request(input: RequestCallPermission, options?: ChannelRequestOptions) {
    return this.resend.post<{ id: string }>(
      "/whatsapp/call-permissions",
      input,
      options
    )
  }
}
