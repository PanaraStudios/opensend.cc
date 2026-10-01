import type { Opensend } from '../../resend';
import { ChannelAccounts } from '../../channels/accounts';
import type { MessengerPage } from '../interfaces';
export class MessengerPages extends ChannelAccounts<MessengerPage> {
  constructor(client: Opensend) {
    super(client, '/messenger/pages');
  }
}
