import type { Opensend } from '../../resend';
import { PageMessages } from '../../channels/page-messages';
import type {
  SendMessengerMessageOptions,
  MessengerMessage,
  MessengerMessageDetail,
} from '../interfaces';
export class MessengerMessages extends PageMessages<
  SendMessengerMessageOptions,
  MessengerMessage,
  MessengerMessageDetail
> {
  constructor(client: Opensend) {
    super(client, 'messenger');
  }
}
