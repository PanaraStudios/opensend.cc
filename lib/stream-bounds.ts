import type { IndexBounds, IndexKey } from "convex-helpers/server/stream"

/** Bounds for the rows strictly after `key` in the stream's order: above it
    when paging backwards (`before`, ascending), below it otherwise. The other
    side is the empty key, inclusive, which leaves it unbounded. */
export function pastKey(key: IndexKey, before: boolean): IndexBounds {
  return before
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
}
