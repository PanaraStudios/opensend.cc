import type { Opensend } from "../resend"
import { buildPaginationQuery } from "../common/utils/build-pagination-query"
import type {
  ChannelPage,
  ChannelRequestOptions,
  ListChannelMessagesOptions,
  MessagingChannel,
} from "./interfaces"

/** SDK option names and REST account filters are mapped in one place. */
const ACCOUNT_FILTERS = {
  whatsapp: { option: "phoneNumberId", query: "phone_number_id" },
  messenger: { option: "accountId", query: "page_id" },
  instagram: { option: "accountId", query: "account_id" },
} as const

type MessageListOptions = ListChannelMessagesOptions<
  "accountId" | "phoneNumberId"
>
export class ChannelMessages<
  S extends { replyTo?: string },
  M,
  D,
  L extends MessageListOptions = ListChannelMessagesOptions,
> {
  constructor(
    private readonly client: Opensend,
    private readonly channel: MessagingChannel
  ) {}
  send(payload: S, options: ChannelRequestOptions = {}) {
    const { replyTo, ...body } = payload
    return this.client.post<{ id: string }>(
      `/${this.channel}/messages`,
      { ...body, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
      options
    )
  }
  get(id: string) {
    return this.client.get<D>(
      `/${this.channel}/messages/${encodeURIComponent(id)}`
    )
  }
  list(options: L = {} as L) {
    const query = new URLSearchParams(buildPaginationQuery(options))
    if (options.status !== undefined) query.set("status", options.status)
    if (options.direction !== undefined)
      query.set("direction", options.direction)
    const filter = ACCOUNT_FILTERS[this.channel]
    const account = options[filter.option]
    if (account !== undefined) query.set(filter.query, account)
    return this.client.get<ChannelPage<M>>(
      `/${this.channel}/messages${query.size ? `?${query}` : ""}`
    )
  }
}
