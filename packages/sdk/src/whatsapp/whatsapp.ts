import type { Opensend } from '../resend';
import { WhatsAppMessages } from './messages/messages';
import { WhatsAppMedia } from './media/media';
import { WhatsAppPhoneNumbers } from './phone-numbers/phone-numbers';
import { WhatsAppConversations } from './conversations/conversations';
export class WhatsApp {
  readonly messages: WhatsAppMessages;
  readonly media: WhatsAppMedia;
  readonly phoneNumbers: WhatsAppPhoneNumbers;
  readonly conversations: WhatsAppConversations;
  constructor(client: Opensend) {
    this.messages = new WhatsAppMessages(client);
    this.media = new WhatsAppMedia(client);
    this.phoneNumbers = new WhatsAppPhoneNumbers(client);
    this.conversations = new WhatsAppConversations(client);
  }
}
