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
} from '../channels/interfaces';
export type SendInstagramMessageOptions = PageMessageOptions & {
  tag?: 'HUMAN_AGENT';
} & (
    | (Extract<PageMessageBody, { text: string }> & {
        quick_replies?: QuickReply[];
      })
    | (Exclude<PageMessageBody, { text: string }> & { quick_replies?: never })
  );
export type InstagramMessage = ChannelMessage<'instagram'>;
export interface InstagramMessageDetail
  extends Omit<InstagramMessage, 'media'>, ChannelMessageEvents {}
export type InstagramConversation = ChannelConversation<'instagram'>;
export type InstagramRequestOptions = ChannelRequestOptions;
export type ListInstagramMessagesOptions = ListChannelMessagesOptions;
export type InstagramAccount = PageAccount & {
  channel: 'instagram';
  instagram_account_id: string;
};
