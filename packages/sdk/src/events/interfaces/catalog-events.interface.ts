import type { Response } from "../../interfaces"
import type { CatalogEvent } from "../catalog"

export interface CatalogEventsOptions {
  /** Custom definitions per page, 1–100 (default 20). System events are included on the first page. */
  limit?: number
  /** Opaque next_cursor from the previous page. Keep search unchanged. */
  after?: string
  search?: string
}
export interface CatalogEventsResponseSuccess {
  object: "event_catalog"
  has_more: boolean
  next_cursor: string | null
  data: CatalogEvent[]
}
export type CatalogEventsResponse = Response<CatalogEventsResponseSuccess>
