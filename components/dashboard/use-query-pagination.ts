"use client"

import type { PaginationStatus } from "convex/react"

import { usePagination } from "@/components/dashboard/primitives"

/** Client pages over a paginated Convex query: `ListPagination` props that
    load the next rows as a page or a larger page size reaches past them. */
export function useQueryPagination<T>(
  rows: readonly T[],
  status: PaginationStatus,
  loadMore: (numItems: number) => void
) {
  const { pageRows, pagination } = usePagination(rows)
  return {
    pageRows,
    pagination: {
      ...pagination,
      hasMore: status !== "Exhausted",
      loading: status === "LoadingMore",
      onPageChange(page: number) {
        if (
          (page + 1) * pagination.pageSize > rows.length &&
          status === "CanLoadMore"
        )
          loadMore(pagination.pageSize)
        pagination.onPageChange(page)
      },
      onPageSizeChange(size: number) {
        pagination.onPageSizeChange(size)
        if (size > rows.length && status === "CanLoadMore")
          loadMore(size - rows.length)
      },
    },
  }
}
