import type { Opensend } from '../resend';
import type { PaginationOptions } from '../common/interfaces/pagination-options.interface';
import { buildPaginationUrl } from '../common/utils/build-pagination-query';
import type {
  ChannelConversation,
  ChannelPage,
  MessagingChannel,
} from './interfaces';
export class ChannelConversations<C extends MessagingChannel, M> {
  constructor(
    private readonly client: Opensend,
    private readonly channel: C
  ) {}
  list(options: PaginationOptions = {}) {
    return this.client.get<ChannelPage<ChannelConversation<C>>>(
      buildPaginationUrl(`/${this.channel}/conversations`, options)
    );
  }
  messages(id: string, options: PaginationOptions = {}) {
    return this.client.get<ChannelPage<M>>(
      buildPaginationUrl(
        `/${this.channel}/conversations/${encodeURIComponent(id)}/messages`,
        options
      )
    );
  }
}
