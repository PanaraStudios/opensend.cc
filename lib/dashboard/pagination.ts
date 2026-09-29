import { formatNumber } from "./format"
/* The list pager's arithmetic. Lists load from the server a page at a time
   (Convex cursor pagination), so the pager steps over the rows loaded so
   far and knows the list's size only when the server counted it or the
   list has run out. */

/** Rows per page the pager offers. */
export const PAGE_SIZES = [40, 80, 120] as const

export type Pager = {
  /** Zero-based page on view. */
  page: number
  pageSize: number
  /** Rows loaded so far. */
  loaded: number
  /** The server's count for the list's filters; null when unknown. */
  total: number | null
  /** Whether more rows may still load. */
  hasMore: boolean
}

/** The list's size, when known: once nothing more can load it is what
    loaded; before that, the server's count, unless it trails what already
    loaded (counts still backfilling after an upgrade). */
export function knownTotal({ loaded, total, hasMore }: Pager): number | null {
  if (!hasMore) return loaded
  return total !== null && total >= loaded ? total : null
}

/** The last page that has rows loaded; the pager never shows past it. */
export const lastLoadedPage = ({
  loaded,
  pageSize,
}: Pick<Pager, "loaded" | "pageSize">) =>
  Math.max(0, Math.ceil(loaded / pageSize) - 1)

export const canGoNext = (pager: Pager) =>
  (pager.page + 1) * pager.pageSize < (knownTotal(pager) ?? Infinity)

/** Whether the list runs past one page: its known size says so, or, while
    the size is unknown, a full first page has loaded with more behind it.
    Measured against the smallest page size, so a larger choice that fits
    the list on one page never hides the control that undoes it. */
export function hasPages(pager: Pager) {
  const pageSize = Math.min(pager.pageSize, PAGE_SIZES[0])
  const total = knownTotal(pager)
  return total === null ? pager.loaded >= pageSize : total > pageSize
}

/** Resend's pager label: "Page 1 – 3 of 120 contacts". While the size is
    unknown it counts what loaded so far: "Page 2 – 2+ of 80+ contacts".
    The noun stays plural, as Resend's does ("of 1 domains"). */
export function pageLabel(pager: Pager, noun: string, plural = `${noun}s`) {
  const total = knownTotal(pager)
  const more = total === null ? "+" : ""
  const size = total ?? pager.loaded
  const pages = Math.max(1, Math.ceil(size / pager.pageSize))
  return `Page ${formatNumber(pager.page + 1)} – ${formatNumber(pages)}${more} of ${formatNumber(size)}${more} ${plural}`
}
