import type { Opensend } from '../../resend';
import { buildPaginationQuery } from '../../common/utils/build-pagination-query';
import type {
  SendWhatsAppMessageOptions,
  WhatsAppRequestOptions,
  WhatsAppMessage,
  WhatsAppMessageDetail,
  ListWhatsAppMessagesOptions,
  WhatsAppPage,
} from '../interfaces';
export class WhatsAppMessages {
  constructor(private readonly resend: Opensend) {}
  send(
    payload: SendWhatsAppMessageOptions,
    options: WhatsAppRequestOptions = {},
  ) {
    const { replyTo, ...body } = payload;
    return this.resend.post<{ id: string }>(
      '/whatsapp/messages',
      { ...body, ...(replyTo !== undefined ? { reply_to: replyTo } : {}) },
      options,
    );
  }
  get(id: string) {
    return this.resend.get<WhatsAppMessageDetail>(
      `/whatsapp/messages/${encodeURIComponent(id)}`,
    );
  }
  list(options: ListWhatsAppMessagesOptions = {}) {
    const query = new URLSearchParams(buildPaginationQuery(options));
    if (options.status !== undefined) query.set('status', options.status);
    if (options.direction !== undefined)
      query.set('direction', options.direction);
    if (options.phoneNumberId !== undefined)
      query.set('phone_number_id', options.phoneNumberId);
    const queryString = query.toString();
    const url = queryString
      ? `/whatsapp/messages?${queryString}`
      : '/whatsapp/messages';
    return this.resend.get<WhatsAppPage<WhatsAppMessage>>(url);
  }
}
