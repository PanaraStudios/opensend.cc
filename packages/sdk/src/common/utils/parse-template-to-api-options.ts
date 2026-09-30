import type {
  CreateEmailTemplateOptions,
  CreateTemplateOptions,
} from '../../templates/interfaces/create-template-options.interface';
import type { UpdateTemplateOptions } from '../../templates/interfaces/update-template.interface';

interface TemplateVariableApiOptions {
  key: string;
  type: 'string' | 'number';
  fallback_value?: string | number | null;
}

interface WhatsAppTemplateApiOptions {
  waba_id?: string;
  language?: string;
  category?: string;
  parameter_format?: 'named' | 'positional';
  components?: Record<string, unknown>[];
}

interface TemplateApiOptions {
  channel?: 'email' | 'whatsapp';
  whatsapp?: WhatsAppTemplateApiOptions;
  name?: string;
  subject?: string | null;
  html?: string;
  text?: string | null;
  alias?: string | null;
  from?: string | null;
  reply_to?: string[] | string;
  variables?: TemplateVariableApiOptions[];
}

function parseVariables(
  variables:
    | CreateEmailTemplateOptions['variables']
    | UpdateTemplateOptions['variables'],
): TemplateVariableApiOptions[] | undefined {
  return variables?.map((variable) => ({
    key: variable.key,
    type: variable.type,
    fallback_value: variable.fallbackValue,
  }));
}

export function parseTemplateToApiOptions(
  template: CreateTemplateOptions | UpdateTemplateOptions,
): TemplateApiOptions {
  if (template.channel === 'whatsapp' || 'whatsapp' in template) {
    const whatsapp = 'whatsapp' in template ? template.whatsapp : undefined;
    return {
      name: 'name' in template ? template.name : undefined,
      alias: 'alias' in template ? template.alias : undefined,
      ...(template.channel ? { channel: template.channel } : {}),
      ...(whatsapp
        ? {
            whatsapp: {
              waba_id: whatsapp.wabaId,
              language: whatsapp.language,
              category: whatsapp.category,
              parameter_format: whatsapp.parameterFormat,
              components: whatsapp.components,
            },
          }
        : {}),
    };
  }
  return {
    ...(template.channel ? { channel: template.channel } : {}),
    name: 'name' in template ? template.name : undefined,
    subject: template.subject,
    html: template.html,
    text: template.text,
    alias: template.alias,
    from: template.from,
    reply_to: template.replyTo,
    variables: parseVariables(template.variables),
  };
}
