import type { PostOptions } from "../common/interfaces"
import type { Opensend } from "../resend"
import type { PaginationOptions } from "../common/interfaces/pagination-options.interface"
import { buildPaginationUrl } from "../common/utils/build-pagination-query"
import type {
  ChannelConversation,
  ChannelPage,
  MessagingChannel,
} from "./interfaces"
export class ChannelConversations<C extends MessagingChannel, M> {
  constructor(
    private readonly client: Opensend,
    private readonly channel: C
  ) {}
  typing(id: string, on: boolean, requestOptions: PostOptions = {}) {
    return this.client.post<{ id: string }>(
      `/${this.channel}/conversations/${encodeURIComponent(id)}/typing`,
      { on },
      requestOptions
    )
  }
  list(options: PaginationOptions = {}) {
    return this.client.get<ChannelPage<ChannelConversation<C>>>(
      buildPaginationUrl(`/${this.channel}/conversations`, options)
    )
  }
  /** Alias for the conversation message feed. */
  listMessages(id: string, options: PaginationOptions = {}) {
    return this.messages(id, options)
  }
  messages(id: string, options: PaginationOptions = {}) {
    return this.client.get<ChannelPage<M>>(
      buildPaginationUrl(
        `/${this.channel}/conversations/${encodeURIComponent(id)}/messages`,
        options
      )
    )
  }
}
