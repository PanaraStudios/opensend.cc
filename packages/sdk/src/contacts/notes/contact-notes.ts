import { buildPaginationUrl } from '../../common/utils/build-pagination-query';
import type { PaginatedData } from '../../common/interfaces';
import type { Resend } from '../../resend';
import type {
  ContactNote,
  CreateContactNoteOptions,
  ListContactNotesOptions,
  UpdateContactNoteOptions,
  RemoveContactNoteOptions,
} from './interfaces';

export class ContactNotes {
  constructor(private readonly resend: Resend) {}

  create(
    { contactId, ...input }: CreateContactNoteOptions,
    options: { idempotencyKey?: string } = {},
  ) {
    const path = `/contacts/${encodeURIComponent(contactId)}/notes`;
    return this.resend.post<ContactNote>(path, input, options);
  }
  list({ contactId, ...pagination }: ListContactNotesOptions) {
    const url = buildPaginationUrl(
      `/contacts/${encodeURIComponent(contactId)}/notes`,
      pagination,
    );
    return this.resend.get<PaginatedData<ContactNote[]>>(url);
  }
  update({ contactId, noteId, body }: UpdateContactNoteOptions) {
    const path = `/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`;
    return this.resend.patch<ContactNote>(path, { body });
  }
  remove({ contactId, noteId }: RemoveContactNoteOptions) {
    const path = `/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`;
    return this.resend.delete<{
      object: 'contact_note';
      id: string;
      deleted: true;
    }>(path);
  }
}
