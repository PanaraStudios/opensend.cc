import type { Opensend } from '../../resend';
import { ChannelAccounts } from '../../channels/accounts';
import type { InstagramAccount } from '../interfaces';
export class InstagramAccounts extends ChannelAccounts<InstagramAccount> {
  constructor(client: Opensend) {
    super(client, '/instagram/accounts');
  }
}
