import { v } from "convex/values"
import { apiError } from "./caller"

export const listArgs = {
  limit: v.number(),
  after: v.optional(v.string()),
  before: v.optional(v.string()),
}
type Page = { limit: number; after?: string; before?: string }
/** Rows strictly newer (`gt`) or older (`lt`) than a creation time. */
type Scan<T> = (
  bound: { lt?: number; gt?: number },
  order: "asc" | "desc",
  count: number
) => Promise<T[]>

/** Resend's list paging, newest first: `after` an id continues to older
    rows, `before` an id goes back to newer ones. `anchor` gives an id's
    creation time within the caller's team, or null. */
export async function cursorPage<T>(
  page: Page,
  anchor: (id: string) => Promise<number | null>,
  scan: Scan<T>
) {
  const cursor = page.before ?? page.after
  const time = cursor === undefined ? undefined : await anchor(cursor)
  if (time === null)
    throw apiError(422, "validation_error", `No item has the id ${cursor}.`)
  if (page.before !== undefined) {
    const rows = await scan({ gt: time }, "asc", page.limit + 1)
    return {
      has_more: rows.length > page.limit,
      data: rows.slice(0, page.limit).reverse(),
    }
  }
  const rows = await scan(
    time === undefined ? {} : { lt: time },
    "desc",
    page.limit + 1
  )
  return { has_more: rows.length > page.limit, data: rows.slice(0, page.limit) }
}
