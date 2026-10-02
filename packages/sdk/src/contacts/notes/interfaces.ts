import type { PaginationOptions, PaginatedData } from '../../common/interfaces';
import type { Response } from '../../interfaces';

export interface ContactNote {
  object: 'contact_note';
  id: string;
  contact_id: string;
  body: string;
  author: { kind: 'user' | 'bot' | 'api'; id?: string; name?: string };
  source: {
    call_id?: string;
    conversation_id?: string;
    message_id?: string;
  } | null;
  created_at: string;
  updated_at: string;
}
export type CreateContactNoteOptions = {
  contactId: string;
  body: string;
  source?: NonNullable<ContactNote['source']>;
};
export type ListContactNotesOptions = PaginationOptions & { contactId: string };
export type UpdateContactNoteOptions = {
  contactId: string;
  noteId: string;
  body: string;
};
export type RemoveContactNoteOptions = { contactId: string; noteId: string };
export type ContactNoteResponse = Response<ContactNote>;
export type ListContactNotesResponse = Response<PaginatedData<ContactNote[]>>;
export type RemoveContactNoteResponse = Response<{
  object: 'contact_note';
  id: string;
  deleted: true;
}>;
