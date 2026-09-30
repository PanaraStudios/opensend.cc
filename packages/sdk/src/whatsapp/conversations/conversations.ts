import type { Opensend } from '../../resend';
import type { PaginationOptions } from '../../common/interfaces/pagination-options.interface';
import { buildPaginationUrl } from '../../common/utils/build-pagination-query';
import type {
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppPage,
} from '../interfaces';
export class WhatsAppConversations {
  constructor(private readonly resend: Opensend) {}
  list(options: PaginationOptions = {}) {
    const url = buildPaginationUrl('/whatsapp/conversations', options);
    return this.resend.get<WhatsAppPage<WhatsAppConversation>>(url);
  }
  messages(id: string, options: PaginationOptions = {}) {
    const url = buildPaginationUrl(
      `/whatsapp/conversations/${encodeURIComponent(id)}/messages`,
      options,
    );
    return this.resend.get<WhatsAppPage<WhatsAppMessage>>(url);
  }
}
