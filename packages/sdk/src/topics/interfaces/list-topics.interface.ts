import type { PaginationOptions, PaginatedData } from '../../common/interfaces';
import type { Response } from '../../interfaces';
import type { Topic } from './topic';

export type ListTopicsOptions = PaginationOptions;

export interface ListTopicsResponseSuccess extends Partial<
  Pick<PaginatedData<Topic[]>, 'object' | 'has_more'>
> {
  data: Topic[];
}

export type ListTopicsResponse = Response<ListTopicsResponseSuccess>;
