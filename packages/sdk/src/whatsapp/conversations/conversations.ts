import type { Opensend } from '../../resend';
import { ChannelConversations } from '../../channels/conversations';
import type { WhatsAppMessage } from '../interfaces';
export class WhatsAppConversations extends ChannelConversations<
  'whatsapp',
  WhatsAppMessage
> {
  constructor(client: Opensend) {
    super(client, 'whatsapp');
  }
}
