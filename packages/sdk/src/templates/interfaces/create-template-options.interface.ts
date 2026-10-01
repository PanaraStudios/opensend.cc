import type { PostOptions } from '../../common/interfaces';
import type { RequireAtLeastOne } from '../../common/interfaces/require-at-least-one';
import type { Response } from '../../interfaces';
import type {
  Template,
  TemplateVariable,
  WhatsAppTemplateOptions,
} from './template';

type TemplateContentCreationOptions = RequireAtLeastOne<{
  html: string;
  react: React.ReactNode;
}>;

type TemplateVariableCreationOptions = Pick<TemplateVariable, 'key' | 'type'> &
  (
    | {
        type: 'string';
        fallbackValue?: string | null;
      }
    | {
        type: 'number';
        fallbackValue?: number | null;
      }
  );

type TemplateOptionalFieldsForCreation = Partial<
  Pick<Template, 'subject' | 'text' | 'alias' | 'from'>
> & {
  replyTo?: string[] | string;
  variables?: TemplateVariableCreationOptions[];
};

export type CreateEmailTemplateOptions = Pick<Template, 'name'> &
  TemplateOptionalFieldsForCreation &
  TemplateContentCreationOptions & { channel?: 'email' };

/** A WhatsApp template: its Meta name (lowercase letters, numbers and
    underscores) and Meta's components, submitted to Meta when published. */
export interface CreateWhatsAppTemplateOptions {
  name: string;
  alias?: string | null;
  channel: 'whatsapp';
  whatsapp?: WhatsAppTemplateOptions;
}

export type CreateTemplateOptions =
  | CreateEmailTemplateOptions
  | CreateWhatsAppTemplateOptions;

export interface CreateTemplateRequestOptions extends PostOptions {}

export interface CreateTemplateResponseSuccess extends Pick<Template, 'id'> {
  object: 'template';
}

export type CreateTemplateResponse = Response<CreateTemplateResponseSuccess>;
