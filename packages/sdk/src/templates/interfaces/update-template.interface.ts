import type { Response } from '../../interfaces';
import type {
  Template,
  TemplateVariable,
  WhatsAppTemplateOptions,
} from './template';

type TemplateVariableUpdateOptions = Pick<TemplateVariable, 'key' | 'type'> &
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

export interface UpdateTemplateOptions
  extends Partial<
    Pick<Template, 'name' | 'subject' | 'html' | 'text' | 'from' | 'alias'>
  > {
  variables?: TemplateVariableUpdateOptions[];
  replyTo?: string[] | string;
  /** A template's channel cannot change; sending it is only a check. */
  channel?: 'email' | 'whatsapp';
  /** A WhatsApp template's settings and components. */
  whatsapp?: WhatsAppTemplateOptions;
}

export interface UpdateTemplateResponseSuccess extends Pick<Template, 'id'> {
  object: 'template';
}

export type UpdateTemplateResponse = Response<UpdateTemplateResponseSuccess>;
