import { WhatsAppCalls } from "./calling/calls"
import { WhatsAppCallPermissions } from "./calling/permissions"
import type { Opensend } from "../resend"
import { WhatsAppMessages } from "./messages/messages"
import { WhatsAppMedia } from "./media/media"
import { WhatsAppPhoneNumbers } from "./phone-numbers/phone-numbers"
import { WhatsAppConversations } from "./conversations/conversations"
export class WhatsApp {
  readonly calls: WhatsAppCalls
  readonly callPermissions: WhatsAppCallPermissions
  readonly messages: WhatsAppMessages
  readonly media: WhatsAppMedia
  readonly phoneNumbers: WhatsAppPhoneNumbers
  readonly conversations: WhatsAppConversations
  constructor(client: Opensend) {
    this.calls = new WhatsAppCalls(client)
    this.callPermissions = new WhatsAppCallPermissions(client)
    this.messages = new WhatsAppMessages(client)
    this.media = new WhatsAppMedia(client)
    this.phoneNumbers = new WhatsAppPhoneNumbers(client)
    this.conversations = new WhatsAppConversations(client)
  }
}
