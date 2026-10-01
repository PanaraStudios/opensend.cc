import type { Opensend } from "../../resend"
import type { ChannelRequestOptions } from "../../channels/interfaces"
import type {
  CallPermissionQuery,
  CallPermission,
  RequestCallPermission,
} from "./interfaces"
export class WhatsAppCallPermissions {
  constructor(private readonly resend: Opensend) {}
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
