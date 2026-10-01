import type { Opensend } from "../../resend"
import { ChannelMessages } from "../../channels/messages"
import type {
  SendWhatsAppMessageOptions,
  WhatsAppMessage,
  WhatsAppMessageDetail,
  ListWhatsAppMessagesOptions,
} from "../interfaces"
export class WhatsAppMessages extends ChannelMessages<
  SendWhatsAppMessageOptions,
  WhatsAppMessage,
  WhatsAppMessageDetail,
  ListWhatsAppMessagesOptions
> {
  constructor(client: Opensend) {
    super(client, "whatsapp")
  }
}
