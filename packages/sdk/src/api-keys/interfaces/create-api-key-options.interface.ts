import type { PostOptions } from '../../common/interfaces';
import type { Response } from '../../interfaces';

export interface CreateApiKeyOptions {
  name: string;
  permission?: 'full_access' | 'sending_access' | 'custom';
  domain_id?: string;
  /** Required for custom permission; write implies read. */
  scopes?: string[];
}

export interface CreateApiKeyRequestOptions extends PostOptions {}

export interface CreateApiKeyResponseSuccess {
  token: string;
  id: string;
}

export type CreateApiKeyResponse = Response<CreateApiKeyResponseSuccess>;
