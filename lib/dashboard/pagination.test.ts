import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  canGoNext,
  cursorListIsEmpty,
  cursorNext,
  cursorPagerVisible,
  cursorPrevious,
  pagedListState,
  hasPages,
  knownTotal,
  lastLoadedPage,
  pageLabel,
  type Pager,
} from "./pagination"

const pager = (patch: Partial<Pager>): Pager => ({
  page: 0,
  pageSize: 40,
  loaded: 40,
  total: null,
  hasMore: true,
  ...patch,
})

describe("id cursors", () => {
  it("walks forward and back without losing the first page", () => {
    const start = { history: [] as (string | undefined)[] }
    const second = cursorNext(start, "a")
    const third = cursorNext(second, "b")
    assert.deepEqual(third, { after: "b", history: [undefined, "a"] })
    assert.deepEqual(cursorPrevious(third), second)
    assert.deepEqual(cursorPrevious(second), { after: undefined, history: [] })
    assert.deepEqual(cursorPrevious(start), { after: undefined, history: [] })
  })
  it("keeps Previous when the current page has no rows", () => {
    const later = cursorNext({ history: [] }, "a")
    assert.equal(cursorListIsEmpty(0, []), true)
    assert.equal(cursorListIsEmpty(0, later.history), false)
    assert.equal(cursorListIsEmpty(3, later.history), false)
    assert.equal(cursorPagerVisible(later.history, false), true)
    assert.equal(cursorPagerVisible([], false), false)
    assert.equal(cursorPagerVisible([], true), true)
  })
})

describe("knownTotal", () => {
  it("takes the server's count while more can load", () => {
    assert.equal(knownTotal(pager({ total: 1000 })), 1000)
  })
  it("is what loaded once the list has run out", () => {
    assert.equal(knownTotal(pager({ loaded: 12, hasMore: false })), 12)
    assert.equal(
      knownTotal(pager({ loaded: 12, total: 30, hasMore: false })),
      12
    )
  })
  it("is unknown without a count, or with one trailing the loaded rows", () => {
    assert.equal(knownTotal(pager({})), null)
    // Counts still backfilling after an upgrade.
    assert.equal(knownTotal(pager({ loaded: 80, total: 3 })), null)
  })
})

describe("pageLabel", () => {
  it("reads like Resend's, with the known total", () => {
    assert.equal(
      pageLabel(pager({ total: 1000 }), "contact"),
      "Page 1 – 25 of 1,000 contacts"
    )
    assert.equal(
      pageLabel(pager({ loaded: 5, hasMore: false }), "log"),
      "Page 1 – 1 of 5 logs"
    )
    // The noun stays plural, as Resend's does.
    assert.equal(
      pageLabel(pager({ loaded: 1, hasMore: false }), "domain"),
      "Page 1 – 1 of 1 domains"
    )
    assert.equal(
      pageLabel(pager({ loaded: 3, hasMore: false }), "property", "properties"),
      "Page 1 – 1 of 3 properties"
    )
  })
  it("counts what loaded, with a plus, while the size is unknown", () => {
    assert.equal(
      pageLabel(pager({ page: 1, loaded: 80 }), "contact"),
      "Page 2 – 2+ of 80+ contacts"
    )
  })
  it("reads sensibly for an empty list", () => {
    assert.equal(
      pageLabel(pager({ loaded: 0, hasMore: false }), "key"),
      "Page 1 – 1 of 0 keys"
    )
  })
})

describe("paging", () => {
  it("steps on while the known total or more rows allow", () => {
    assert.equal(canGoNext(pager({ total: 41 })), true)
    assert.equal(canGoNext(pager({ total: 40 })), false)
    assert.equal(canGoNext(pager({ page: 1, loaded: 80, total: 80 })), false)
    // Unknown size: another page may load.
    assert.equal(canGoNext(pager({})), true)
    assert.equal(canGoNext(pager({ loaded: 40, hasMore: false })), false)
  })
  it("knows when the list runs past one page", () => {
    assert.equal(hasPages(pager({ total: 41 })), true)
    assert.equal(hasPages(pager({ total: 40 })), false)
    assert.equal(hasPages(pager({ loaded: 3, hasMore: false })), false)
    assert.equal(hasPages(pager({ loaded: 0, hasMore: false })), false)
    // Unknown size: a full page with more to load is more than one page.
    assert.equal(hasPages(pager({})), true)
    // The first page is still filling.
    assert.equal(hasPages(pager({ loaded: 0 })), false)
    assert.equal(hasPages(pager({ loaded: 12 })), false)
    // A larger page that holds the whole list keeps the pager, whose size
    // control is the way back to a smaller page.
    assert.equal(
      hasPages(pager({ pageSize: 80, loaded: 50, hasMore: false })),
      true
    )
  })
  it("never shows past the loaded rows", () => {
    assert.equal(lastLoadedPage({ loaded: 0, pageSize: 40 }), 0)
    assert.equal(lastLoadedPage({ loaded: 40, pageSize: 40 }), 0)
    assert.equal(lastLoadedPage({ loaded: 41, pageSize: 40 }), 1)
  })
})

describe("skipped lists", () => {
  it("exhausts skipped first pages and drops stale loaded results without loading more", () => {
    let loads = 0
    for (const status of [
      "LoadingFirstPage",
      "CanLoadMore",
      "LoadingMore",
      "Exhausted",
    ] as const) {
      const result = pagedListState(
        {
          results: ["old contact"],
          isLoading: true,
          status,
          loadMore: (numItems: number) => {
            assert.equal(numItems, 40)
            loads++
          },
        },
        true
      )
      assert.deepEqual(result.results, [])
      assert.equal(result.status, "Exhausted")
      assert.equal(result.isLoading, false)
      result.loadMore(40)
    }
    assert.equal(loads, 0)
  })
  it("preserves loading and pagination for enabled callers", () => {
    let loads = 0
    for (const status of [
      "LoadingFirstPage",
      "CanLoadMore",
      "LoadingMore",
      "Exhausted",
    ] as const) {
      const query = {
        results: ["contact"],
        status,
        loadMore: (numItems: number) => {
          assert.equal(numItems, 40)
          loads++
        },
      }
      assert.equal(pagedListState(query, false), query)
      pagedListState(query, false).loadMore(40)
    }
    assert.equal(loads, 4)
  })
})
