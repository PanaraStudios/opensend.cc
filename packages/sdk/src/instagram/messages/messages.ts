import type { Opensend } from '../../resend';
import { PageMessages } from '../../channels/page-messages';
import type {
  SendInstagramMessageOptions,
  InstagramMessage,
  InstagramMessageDetail,
} from '../interfaces';
export class InstagramMessages extends PageMessages<
  SendInstagramMessageOptions,
  InstagramMessage,
  InstagramMessageDetail
> {
  constructor(client: Opensend) {
    super(client, 'instagram');
  }
}
