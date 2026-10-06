import type { IdempotentRequest } from "./idempotent-request.interface"

export interface PostOptions extends IdempotentRequest {
  query?: { [key: string]: unknown }
  headers?: HeadersInit
}
