import type { Opensend } from '../resend';
import { MessengerMessages } from './messages/messages';
import { MessengerConversations } from './conversations/conversations';
import { MessengerPages } from './pages/pages';
export class Messenger {
  readonly messages: MessengerMessages;
  readonly conversations: MessengerConversations;
  readonly pages: MessengerPages;
  constructor(client: Opensend) {
    this.messages = new MessengerMessages(client);
    this.conversations = new MessengerConversations(client);
    this.pages = new MessengerPages(client);
  }
}
