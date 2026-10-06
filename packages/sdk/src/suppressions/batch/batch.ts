import type { PostOptions } from '../../common/interfaces';
import type { Resend } from '../../resend';
import type {
  BatchAddSuppressionsOptions,
  BatchAddSuppressionsResponse,
  BatchAddSuppressionsResponseSuccess,
  BatchRemoveSuppressionsOptions,
  BatchRemoveSuppressionsResponse,
  BatchRemoveSuppressionsResponseSuccess,
} from './interfaces';

export class Batch {
  constructor(private readonly resend: Resend) {}

  async add(
    options: BatchAddSuppressionsOptions,
    requestOptions: PostOptions = {},
  ): Promise<BatchAddSuppressionsResponse> {
    return this.resend.post<BatchAddSuppressionsResponseSuccess>(
      '/suppressions/batch/add',
      options,
      requestOptions,
    );
  }

  async remove(
    options: BatchRemoveSuppressionsOptions,
    requestOptions: PostOptions = {},
  ): Promise<BatchRemoveSuppressionsResponse> {
    return this.resend.post<BatchRemoveSuppressionsResponseSuccess>(
      '/suppressions/batch/remove',
      options,
      requestOptions,
    );
  }
}
