import { v } from "convex/values"
import { QueryStream } from "convex-helpers/server/stream"
import { invalid } from "./caller"
import { pastAnchor } from "../../lib/stream-bounds"

export const listArgs = {
  limit: v.number(),
  after: v.optional(v.string()),
  before: v.optional(v.string()),
}
type Page = { limit: number; after?: string; before?: string }
type Row = { _id: string; _creationTime: number }
type Rows<T extends Row> = QueryStream<T> | T[]

/** The anchor is resolved within the resource's team/parent before its complete
    index key is used, including the implicit creation time and id tie-break. */
export async function cursorPage<T extends Row>(
  page: Page,
  anchor: (id: string) => Promise<Row | null>,
  scan: (order: "asc" | "desc") => Rows<T> | Promise<Rows<T>>
) {
  const cursor = page.before ?? page.after
  const row = cursor === undefined ? undefined : await anchor(cursor)
  if (row === null) throw invalid(`No item has the id ${cursor}.`)
  const before = page.before !== undefined
  const source = await scan(before ? "asc" : "desc")
  let rows: T[]
  if (Array.isArray(source)) {
    // Only bounded relation/property sets use in-memory ordering.
    const compare = (a: Row, b: Row) =>
      a._creationTime - b._creationTime ||
      (a._id < b._id ? -1 : a._id > b._id ? 1 : 0)
    rows = source
      .filter(
        (item) =>
          !row || (before ? compare(item, row) > 0 : compare(item, row) < 0)
      )
      .sort((a, b) => (before ? compare(a, b) : compare(b, a)))
      .slice(0, page.limit + 1)
  } else {
    rows = await pastAnchor(source, row).take(page.limit + 1)
  }
  const data = rows.slice(0, page.limit)
  if (before) data.reverse()
  return { has_more: rows.length > page.limit, data }
}
