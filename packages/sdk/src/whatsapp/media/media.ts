import type { Opensend } from '../../resend';
import type {
  UploadWhatsAppMediaOptions,
  WhatsAppRequestOptions,
} from '../interfaces';
export class WhatsAppMedia {
  constructor(private readonly resend: Opensend) {}
  upload(
    payload: UploadWhatsAppMediaOptions,
    options: WhatsAppRequestOptions = {},
  ) {
    const form = new FormData();
    form.append('file', payload.file, payload.filename ?? 'attachment');
    if (payload.from !== undefined) form.append('from', payload.from);
    if (payload.type !== undefined) form.append('type', payload.type);
    return this.resend.post<{ id: string }>('/whatsapp/media', form, options);
  }
}
