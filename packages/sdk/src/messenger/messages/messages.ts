import type { Opensend } from "../../resend"
import { ChannelMessages } from "../../channels/messages"
import type {
  SendMessengerMessageOptions,
  MessengerMessage,
  MessengerMessageDetail,
} from "../interfaces"
export class MessengerMessages extends ChannelMessages<
  SendMessengerMessageOptions,
  MessengerMessage,
  MessengerMessageDetail
> {
  constructor(client: Opensend) {
    super(client, "messenger")
  }
}
