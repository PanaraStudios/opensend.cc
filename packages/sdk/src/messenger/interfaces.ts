import type {
  ChannelMessage,
  ChannelMessageEvents,
  ChannelConversation,
  ChannelRequestOptions,
  ListChannelMessagesOptions,
  PageAccount,
  PageMessageOptions,
  PageMessageBody,
  QuickReply,
  PageMessageTag,
} from '../channels/interfaces';
export type SendMessengerMessageOptions = PageMessageOptions & {
  tag?: PageMessageTag;
} & PageMessageBody & { quick_replies?: QuickReply[] };
export type MessengerMessage = ChannelMessage<'messenger'>;
export interface MessengerMessageDetail
  extends Omit<MessengerMessage, 'media'>, ChannelMessageEvents {}
export type MessengerConversation = ChannelConversation<'messenger'>;
export type MessengerRequestOptions = ChannelRequestOptions;
export type ListMessengerMessagesOptions = ListChannelMessagesOptions;
export type MessengerPage = PageAccount & { channel: 'messenger' };
