import type { Opensend } from '../resend';
import type { PaginationOptions } from '../common/interfaces/pagination-options.interface';
import { buildPaginationUrl } from '../common/utils/build-pagination-query';
import type { ChannelPage } from './interfaces';
export class ChannelAccounts<A> {
  constructor(
    private readonly client: Opensend,
    private readonly path: string
  ) {}
  list(options: PaginationOptions = {}) {
    return this.client.get<ChannelPage<A>>(
      buildPaginationUrl(this.path, options)
    );
  }
  get(id: string) {
    return this.client.get<A>(`${this.path}/${encodeURIComponent(id)}`);
  }
}
