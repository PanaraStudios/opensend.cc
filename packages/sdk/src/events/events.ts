import type { PostOptions } from "../common/interfaces"
import type {
  CatalogEventsOptions,
  CatalogEventsResponse,
} from "./interfaces/catalog-events.interface"
import {
  buildPaginationQuery,
  buildPaginationUrl,
} from "../common/utils/build-pagination-query"
import { parseEventToApiOptions } from "../common/utils/parse-automation-to-api-options"
import type { Resend } from "../resend"
import type {
  CreateEventOptions,
  CreateEventResponse,
  CreateEventResponseSuccess,
} from "./interfaces/create-event.interface"
import type {
  GetEventResponse,
  GetEventResponseSuccess,
} from "./interfaces/get-event.interface"
import type {
  ListEventsOptions,
  ListEventsResponse,
  ListEventsResponseSuccess,
} from "./interfaces/list-events.interface"
import type {
  RemoveEventResponse,
  RemoveEventResponseSuccess,
} from "./interfaces/remove-event.interface"
import type {
  SendEventOptions,
  SendEventResponse,
  SendEventResponseSuccess,
} from "./interfaces/send-event.interface"
import type {
  UpdateEventOptions,
  UpdateEventResponse,
  UpdateEventResponseSuccess,
} from "./interfaces/update-event.interface"

export class Events {
  constructor(private readonly resend: Resend) {}

  async catalog(
    options: CatalogEventsOptions = {}
  ): Promise<CatalogEventsResponse> {
    const params = new URLSearchParams(buildPaginationQuery(options))
    if (options.search !== undefined) params.set("search", options.search)
    const query = params.toString()
    const url = query ? `/events/catalog?${query}` : "/events/catalog"
    return this.resend.get(url)
  }

  async send(
    payload: SendEventOptions,
    requestOptions: PostOptions = {}
  ): Promise<SendEventResponse> {
    const data = await this.resend.post<SendEventResponseSuccess>(
      "/events/send",
      parseEventToApiOptions(payload),
      requestOptions
    )

    return data
  }

  async create(
    payload: CreateEventOptions,
    requestOptions: PostOptions = {}
  ): Promise<CreateEventResponse> {
    const data = await this.resend.post<CreateEventResponseSuccess>(
      "/events",
      payload,
      requestOptions
    )

    return data
  }

  async get(identifier: string): Promise<GetEventResponse> {
    const data = await this.resend.get<GetEventResponseSuccess>(
      `/events/${encodeURIComponent(identifier)}`
    )
    return data
  }

  async list(options: ListEventsOptions = {}): Promise<ListEventsResponse> {
    const url = buildPaginationUrl("/events", options)
    const data = await this.resend.get<ListEventsResponseSuccess>(url)
    return data
  }

  async update(
    identifier: string,
    payload: UpdateEventOptions
  ): Promise<UpdateEventResponse> {
    const data = await this.resend.patch<UpdateEventResponseSuccess>(
      `/events/${encodeURIComponent(identifier)}`,
      payload
    )
    return data
  }

  async remove(identifier: string): Promise<RemoveEventResponse> {
    const data = await this.resend.delete<RemoveEventResponseSuccess>(
      `/events/${encodeURIComponent(identifier)}`
    )
    return data
  }
}
