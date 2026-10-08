import type { QueryStream } from "convex-helpers/server/stream"
import type { Value } from "convex/values"

/** The stream's rows strictly after `anchor` in the stream's own order, or the
    whole stream without one. The anchor must be a row this stream returns,
    so its index fields form the key. The other side is the empty key,
    inclusive, which leaves it unbounded. */
export function pastAnchor<T extends NonNullable<unknown>>(
  source: QueryStream<T>,
  anchor: object | null | undefined
): QueryStream<T> {
  if (!anchor) return source
  const row = anchor as Record<string, Value>
  const key = source.getIndexFields().map((field) => row[field])
  return source.narrow(
    source.getOrder() === "asc"
      ? {
          lowerBound: key,
          lowerBoundInclusive: false,
          upperBound: [],
          upperBoundInclusive: true,
        }
      : {
          lowerBound: [],
          lowerBoundInclusive: true,
          upperBound: key,
          upperBoundInclusive: false,
        }
  )
}
