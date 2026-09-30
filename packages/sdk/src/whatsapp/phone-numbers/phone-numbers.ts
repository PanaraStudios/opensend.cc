import type { Opensend } from '../../resend';
import type { PaginationOptions } from '../../common/interfaces/pagination-options.interface';
import { buildPaginationUrl } from '../../common/utils/build-pagination-query';
import type { WhatsAppPhoneNumber, WhatsAppPage } from '../interfaces';
export class WhatsAppPhoneNumbers {
  constructor(private readonly resend: Opensend) {}
  list(options: PaginationOptions = {}) {
    const url = buildPaginationUrl('/whatsapp/phone-numbers', options);
    return this.resend.get<WhatsAppPage<WhatsAppPhoneNumber>>(url);
  }
  get(id: string) {
    return this.resend.get<WhatsAppPhoneNumber>(
      `/whatsapp/phone-numbers/${encodeURIComponent(id)}`,
    );
  }
}
