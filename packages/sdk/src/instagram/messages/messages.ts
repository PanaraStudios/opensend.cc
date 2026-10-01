import type { Opensend } from "../../resend"
import { ChannelMessages } from "../../channels/messages"
import type {
  SendInstagramMessageOptions,
  InstagramMessage,
  InstagramMessageDetail,
} from "../interfaces"
export class InstagramMessages extends ChannelMessages<
  SendInstagramMessageOptions,
  InstagramMessage,
  InstagramMessageDetail
> {
  constructor(client: Opensend) {
    super(client, "instagram")
  }
}
