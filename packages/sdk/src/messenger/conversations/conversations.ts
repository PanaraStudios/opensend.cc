import type { Opensend } from '../../resend';
import { ChannelConversations } from '../../channels/conversations';
import type { MessengerMessage } from '../interfaces';
export class MessengerConversations extends ChannelConversations<
  'messenger',
  MessengerMessage
> {
  constructor(client: Opensend) {
    super(client, 'messenger');
  }
}
