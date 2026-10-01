import type { Opensend } from "../../resend"
import { ChannelAccounts } from "../../channels/accounts"
import type { WhatsAppPhoneNumber } from "../interfaces"
export class WhatsAppPhoneNumbers extends ChannelAccounts<WhatsAppPhoneNumber> {
  constructor(client: Opensend) {
    super(client, "/whatsapp/phone-numbers")
  }
}
