export interface Template {
  id: string;
  name: string;
  subject: string | null;
  html: string;
  text: string | null;
  status: 'draft' | 'published';
  variables: TemplateVariable[] | null;
  alias: string | null;
  from: string | null;
  reply_to: string[] | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  has_unpublished_versions: boolean;
  current_version_id: string;
  /** Present on WhatsApp templates; absent means email. */
  channel?: 'whatsapp';
  whatsapp?: WhatsAppTemplate;
}

/** One of Meta's template components, in its creation format. */
export type WhatsAppTemplateComponent = Record<string, unknown> & {
  type: string;
};

export type WhatsAppTemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type WhatsAppTemplateStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'IN_APPEAL'
  | 'LIMIT_EXCEEDED'
  | 'ARCHIVED'
  | 'PENDING_DELETION'
  | 'DELETED';

/** A WhatsApp template's place at Meta. */
export interface WhatsAppTemplate {
  waba_id: string;
  language: string;
  category: WhatsAppTemplateCategory;
  parameter_format: 'named' | 'positional';
  meta_template_id: string | null;
  /** Meta's review status; null until submitted. Sends need APPROVED. */
  status: WhatsAppTemplateStatus | null;
  rejected_reason: string | null;
  quality: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null;
  submitted_at: string | null;
  synced_at: string | null;
  /** The draft's components; only on a retrieved template. */
  components?: WhatsAppTemplateComponent[];
}

/** A WhatsApp template's settings and components, as requests take them. */
export interface WhatsAppTemplateOptions {
  /** The team's first WhatsApp Business Account when omitted. */
  wabaId?: string;
  /** Meta's language code, `en_US` when omitted. */
  language?: string;
  category?: WhatsAppTemplateCategory;
  /** Optional check; the components' variables decide it. */
  parameterFormat?: 'named' | 'positional';
  components?: WhatsAppTemplateComponent[];
}

export interface TemplateVariable {
  key: string;
  fallback_value: string | number | null;
  type: 'string' | 'number';
  created_at: string;
  updated_at: string;
}
