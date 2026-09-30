import { getPaginationQueryProperties } from '../common/utils/get-pagination-query-properties';
import { parseTemplateToApiOptions } from '../common/utils/parse-template-to-api-options';
import { render } from '../render';
import type { Resend } from '../resend';
import { ChainableTemplateResult } from './chainable-template-result';
import type {
  CreateTemplateOptions,
  CreateTemplateResponse,
  CreateTemplateResponseSuccess,
} from './interfaces/create-template-options.interface';
import type {
  DuplicateTemplateResponse,
  DuplicateTemplateResponseSuccess,
} from './interfaces/duplicate-template.interface';
import type {
  GetTemplateResponse,
  GetTemplateResponseSuccess,
} from './interfaces/get-template.interface';
import type {
  ListTemplatesOptions,
  ListTemplatesResponse,
  ListTemplatesResponseSuccess,
} from './interfaces/list-templates.interface';
import type {
  PublishTemplateResponse,
  PublishTemplateResponseSuccess,
} from './interfaces/publish-template.interface';
import type {
  RemoveTemplateResponse,
  RemoveTemplateResponseSuccess,
} from './interfaces/remove-template.interface';
import type {
  UpdateTemplateOptions,
  UpdateTemplateResponse,
  UpdateTemplateResponseSuccess,
} from './interfaces/update-template.interface';

export class Templates {
  constructor(private readonly resend: Resend) {}

  create(
    payload: CreateTemplateOptions,
  ): ChainableTemplateResult<CreateTemplateResponse> {
    const createPromise = this.performCreate(payload);
    return new ChainableTemplateResult(createPromise, this.publish.bind(this));
  }
  // This creation process is being done separately from the public create so that
  // the user can chain the publish operation after the create operation. Otherwise, due
  // to the async nature of the render, the return type would be
  // Promise<ChainableTemplateResult<CreateTemplateResponse>> which wouldn't be chainable.
  private async performCreate(
    payload: CreateTemplateOptions,
  ): Promise<CreateTemplateResponse> {
    const body: CreateTemplateOptions = { ...payload };

    if (body.channel !== 'whatsapp' && body.react) {
      body.html = await render(body.react);
    }

    return this.resend.post<CreateTemplateResponseSuccess>(
      '/templates',
      parseTemplateToApiOptions(body),
    );
  }

  async remove(identifier: string): Promise<RemoveTemplateResponse> {
    const data = await this.resend.delete<RemoveTemplateResponseSuccess>(
      `/templates/${identifier}`,
    );
    return data;
  }

  async get(identifier: string): Promise<GetTemplateResponse> {
    const data = await this.resend.get<GetTemplateResponseSuccess>(
      `/templates/${identifier}`,
    );
    return data;
  }

  async list(options: ListTemplatesOptions = {}): Promise<ListTemplatesResponse> {
    const params = new URLSearchParams(
      getPaginationQueryProperties(options).slice(1),
    );
    if (options.channel) params.set('channel', options.channel);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    return this.resend.get<ListTemplatesResponseSuccess>(`/templates${query}`);
  }

  duplicate(
    identifier: string,
  ): ChainableTemplateResult<DuplicateTemplateResponse> {
    const promiseDuplicate = this.resend.post<DuplicateTemplateResponseSuccess>(
      `/templates/${identifier}/duplicate`,
    );
    return new ChainableTemplateResult(
      promiseDuplicate,
      this.publish.bind(this),
    );
  }

  async publish(identifier: string): Promise<PublishTemplateResponse> {
    const data = await this.resend.post<PublishTemplateResponseSuccess>(
      `/templates/${identifier}/publish`,
    );
    return data;
  }

  async update(
    identifier: string,
    payload: UpdateTemplateOptions,
  ): Promise<UpdateTemplateResponse> {
    const data = await this.resend.patch<UpdateTemplateResponseSuccess>(
      `/templates/${identifier}`,
      parseTemplateToApiOptions(payload),
    );
    return data;
  }
}
