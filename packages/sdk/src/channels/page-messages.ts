import type { Opensend } from '../resend';
import { buildPaginationQuery } from '../common/utils/build-pagination-query';
import type {
  ChannelPage,
  ChannelRequestOptions,
  ListChannelMessagesOptions,
  PageMessageOptions,
} from './interfaces';
export class PageMessages<S extends PageMessageOptions, M, D> {
  constructor(
    private readonly client: Opensend,
    private readonly channel: 'messenger' | 'instagram'
  ) {}
  send(payload: S, options: ChannelRequestOptions = {}) {
    const { replyTo, ...body } = payload;
    return this.client.post<{ id: string }>(
      `/${this.channel}/messages`,
      { ...body, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
      options
    );
  }
  get(id: string) {
    return this.client.get<D>(
      `/${this.channel}/messages/${encodeURIComponent(id)}`
    );
  }
  list(options: ListChannelMessagesOptions = {}) {
    const query = new URLSearchParams(buildPaginationQuery(options));
    if (options.status !== undefined) query.set('status', options.status);
    if (options.direction !== undefined)
      query.set('direction', options.direction);
    if (options.accountId !== undefined)
      query.set(
        this.channel === 'messenger' ? 'page_id' : 'account_id',
        options.accountId
      );
    return this.client.get<ChannelPage<M>>(
      `/${this.channel}/messages${query.size ? `?${query}` : ''}`
    );
  }
}
