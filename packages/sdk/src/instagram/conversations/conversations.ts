import type { Opensend } from '../../resend';
import { ChannelConversations } from '../../channels/conversations';
import type { InstagramMessage } from '../interfaces';
export class InstagramConversations extends ChannelConversations<
  'instagram',
  InstagramMessage
> {
  constructor(client: Opensend) {
    super(client, 'instagram');
  }
}
