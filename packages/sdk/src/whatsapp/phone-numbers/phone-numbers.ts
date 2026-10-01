import type {
  PhoneNumberCalling,
  UpdateCallingSettings,
} from "../calling/interfaces"
import type { ChannelRequestOptions } from "../../channels/interfaces"
import type { Opensend } from "../../resend"
import { ChannelAccounts } from "../../channels/accounts"
import type { WhatsAppPhoneNumber } from "../interfaces"
export class WhatsAppPhoneNumbers extends ChannelAccounts<WhatsAppPhoneNumber> {
  private readonly resend: Opensend
  constructor(client: Opensend) {
    super(client, "/whatsapp/phone-numbers")
    this.resend = client
  }
  getCalling(id: string) {
    return this.resend.get<PhoneNumberCalling>(
      `/whatsapp/phone-numbers/${encodeURIComponent(id)}/calling`
    )
  }
  updateCalling(
    id: string,
    input: UpdateCallingSettings,
    options?: ChannelRequestOptions
  ) {
    return this.resend.post<PhoneNumberCalling>(
      `/whatsapp/phone-numbers/${encodeURIComponent(id)}/calling`,
      input,
      options
    )
  }
}
