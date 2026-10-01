import type { Opensend } from '../resend';
import { InstagramMessages } from './messages/messages';
import { InstagramConversations } from './conversations/conversations';
import { InstagramAccounts } from './accounts/accounts';
export class Instagram {
  readonly messages: InstagramMessages;
  readonly conversations: InstagramConversations;
  readonly accounts: InstagramAccounts;
  constructor(client: Opensend) {
    this.messages = new InstagramMessages(client);
    this.conversations = new InstagramConversations(client);
    this.accounts = new InstagramAccounts(client);
  }
}
