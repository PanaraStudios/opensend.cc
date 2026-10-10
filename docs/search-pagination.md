# Dashboard substring search

Dashboard searches scan ordinary, team-scoped indexes and keep rows containing the entire trimmed query, ignoring case. They support prefixes, interior substrings, punctuation, multiword names, Unicode and long terms. Search input is no longer silently truncated. Results use the ordinary list's newest-first order (non-search segment lists retain membership order), rather than full-text relevance.

## Why full-text candidates were incomplete

The findings below were checked against backend source revision `b7cce5a2331854895d36b683d1eab17c47ef13a9` (the `org.opencontainers.image.revision` label of the image pinned at the time). `compose.yaml` now pins revision `5c7cb5bc7db457290f1769f95f1d1340912f7fd7`:

- [`MAX_UNIQUE_QUERY_TERMS = 64`](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/constants.rs#L40-L42) caps expanded terms across memory and disk. [`search`](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/lib.rs#L477-L575) adds equality-filter terms to the same pool. The [aggregator](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/aggregation.rs#L55-L129) retains the best 64 unique terms. With one team filter, only 63 distinct prefix expansions remain. This explains the reported `contact0900`–`contact0962` result: discarded terms never reach pagination or the substring predicate. Additional filters can reduce this further.
- [`MAX_CANDIDATE_REVISIONS = 1024`](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/constants.rs#L17-L18) independently limits candidate revisions. The [search iterator](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/database/src/query/search_query.rs#L220-L245) errors at that scan limit; it does not explain a silent 63-row result.
- There is also a [`MAX_PREFIX_MATCHES_PER_QUERY_TERM = 16`](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/constants.rs#L32-L42) constant used by `bound_and_evaluate_query_terms` in the memory index. The main search path above uses `query_tokens` and the shared 64-term aggregator instead. Do not mistake the 16 constant for the observed limit. Although the source retains fuzzy-search machinery and `MAX_EDIT_DISTANCE = 2`, [queries now request distance zero](https://github.com/get-convex/convex-backend/blob/b7cce5a2331854895d36b683d1eab17c47ef13a9/crates/search/src/query.rs#L134-L136).
- The [official text-search docs](https://docs.convex.dev/search/text-search#limits) describe tokenization on whitespace/punctuation, 32-character terms, at most 16 query terms and a 1,024-result scan limit. The final term gets prefix matching; fuzzy matching is deprecated. Token matching also cannot supply all arbitrary interior substrings, regardless of expansion limits.

## Bounded, complete pagination

`convex/lists.ts` supplies `filteredPage`, used directly by contacts, keys, templates, logs and custom events, and through `teamPage` by segments, topics, properties and webhooks. Existing contact/key/log/segment export readers inherit the fix too.

The scan budgets below are passed as named constants by each list. They are designed against Convex's documented [per-transaction limits](https://docs.convex.dev/production/state/limits#transactions): **32,000 documents scanned, 16 MiB read and 4,096 index ranges**. The maximum document and function return sizes are 1 MiB and 16 MiB respectively.

| List / constant | Source rows per request | Byte budget | Reservation per kept match |
| --- | ---: | ---: | ---: |
| Contacts / `CONTACT_SEARCH_BUDGET` | 1,024 | 8 MiB | None; rows carry no memberships |
| Templates / `TEMPLATE_SEARCH_BUDGET` | 512 | 8 MiB | 1 MiB for a draft |
| API keys / `KEY_SEARCH_BUDGET` | 512 | 4 MiB | 1 KiB for the usage row |
| Logs / `LOG_SEARCH_BUDGET` | 1,024 | 4 MiB | None |
| Segments / `SEGMENT_SEARCH_BUDGET` | 256 | 4 MiB | 128 KiB for the aggregate total |
| Topics / `TOPIC_SEARCH_BUDGET` | 512 | 4 MiB | None |
| Properties / `PROPERTY_SEARCH_BUDGET` | 512 | 4 MiB | None |
| Webhooks / `WEBHOOK_SEARCH_BUDGET` | 512 | 4 MiB | None |
| Custom events / `EVENT_SEARCH_BUDGET` | 512 | 4 MiB | None |
| Export history / `EXPORT_SEARCH_BUDGET` | 1,024 | 4 MiB | None; metadata only |

The byte budget includes **source document bytes plus reservations for subsequent hydration**. The installed `convex-helpers` 0.1.127 `QueryStream` paginator walks an ordinary index, counts rejected rows, and retains each inspected row's index key. The shared `SearchStream` wrapper adds a reservation only when a row passes the predicate. It does not fetch drafts for rejected rows. A template search can scan 512 nonmatches, or at most eight matches needing drafts.

The budget is independent of the UI's requested result count: requesting just one additional match still permits a full bounded scan. The same row and byte ceilings apply during an `endCursor` replay, when ordinary pagination ignores `numItems`. Stricter caller ceilings are honored; zero cannot disable them. The final inspected row may cross the byte threshold, so the arithmetic below reserves headroom for that overshoot.

### Read-cost arithmetic

- **Contacts:** a team has any number of segments and a contact can be in any number, so list rows hydrate no memberships. The contact screen pages a contact's segments (`contacts.segments`, the `by_contactId` index), and a segment's contact list checks membership for the page on view only (`segments.memberIds`, one exact lookup per row, at most 120). A search reads at most 1,024 source contacts and, when filtered by a segment, up to 1,024 exact membership checks: **2,048 documents** and about **1,030 ranges**, plus authorization. Source bytes stop at 8 MiB, with at most 1 MiB overshoot from the last source row; the membership checks add at most 1 MiB.
- **Templates:** `checkInput` allows 256 KiB HTML and 256 KiB editor content separately. Reserving the full **1 MiB document limit** for each kept draft also covers document overhead and historical drafts. Eight matches read at most eight drafts. Source bytes plus reservations are at most **8 MiB + 1 MiB source overshoot + 1 MiB draft reservation**, leaving at least 6 MiB of headroom. Up to 512 metadata documents plus eight drafts is far below the document/range limits.
- **API keys:** there is a usage lookup in `viewKey`, despite these appearing to be metadata-only rows. 512 source keys plus 512 tiny `apiKeyUsage` documents uses at most **1,024 documents and 513 ranges**, plus authorization. The 1 KiB reservation covers the usage ID and timestamp. Source bytes plus reservations stay below **4 MiB + 1 MiB + 1 KiB**, leaving nearly 11 MiB headroom. At most 512 hydration operations run concurrently, below the 1,000 outstanding-I/O limit.
- **Segments:** `withSizes` reads batched aggregate totals. The installed aggregate's default B-tree node size is 16; an unbounded namespace total reads the tree, root, and at most 17 immediate children with stored aggregates, independently of membership count. Our aggregate keys/values contain only empty keys and membership IDs, so these small nodes fit comfortably in a **128 KiB reservation per segment**. This limits dense search pages to 32 totals: at most **256 + 32 × 19 = 864 documents/ranges**, plus the shared pending-operation check and authorization. At most 544 child-node reads can be outstanding. The byte ceiling plus last-row overshoot stays below **4 MiB + 1 MiB + 128 KiB**. Segment CSV exports use the same budget.
- **Logs, topics, properties, webhooks, events, export metadata:** no downstream document hydration. These read at most 512 or 1,024 documents from the chosen index, and **4 MiB + at most one 1 MiB document**. The remaining 11 MiB and over 30,000 document reads are headroom. Export history currently has no search argument, so its normal pagination remains unchanged; its named budget is ready for the shared search path. Contact, key, log and segment CSV readers inherit their list's budget.

Searches now scan contacts directly even when filtering by a segment: the full contact bytes count toward the scan ceiling, and only substring/date/subscription matches need a membership existence lookup. This avoids an unmetered contact-document fetch for every scanned membership. Non-search segment pagination remains unchanged.

The helper returns `continueCursor`, `isDone`, `splitCursor` and `pageStatus` from the stream paginator unchanged. It never slices away excess matches after selecting a continuation cursor. Empty/short pages do not imply exhaustion. The existing pager loads on and uses Convex's split protocol; search count queries still return `{ total: null }`. Totals become exact only after all pages are loaded. No query shapes intentionally return incomplete results.

For sparse, small contact documents, 10,000 candidates take **10 scan requests** rather than 625, and 100,000 take **98** rather than 6,250. React may issue additional requests to split reactive pages, and byte-heavy records stop earlier. Searching is still linear over the selected team/filter range; this change reduces sequential request overhead without sacrificing completeness. Edge n-grams cannot cover arbitrary interior substrings, and full-text candidate limits still apply. Non-search queries use the underlying native paginator with the original options and cursors.

## Upgrade and verification

No schema, search-field contents or writes changed, so existing rows work immediately with no migration/backfill. Full-text indexes remain defined for compatibility, but these lists no longer query them. Reload open dashboard lists after deployment: searches now use the stream paginator’s cursors, while non-search cursors remain native.

`convex/searchPagination.test.ts` covers 120 distinct prefixes, 1,050 matching contacts, a rare match among 10,000 contacts (ten requests and one hydration), byte-heavy source rows, template hydration reservations, reactive end-cursor replay and splitting, empty-page continuation, unique cursors, whole-query semantics, filters, historical rows, count/pager behavior, team authorization and helper read/split contracts. `convex-test` 0.0.58 implements search with whitespace splitting and `startsWith`; it does **not** simulate the production 64-term expansion cap. Thus the prefix-volume tests demonstrate the new path's completeness, not a reproduction of the engine's cap. Interior-substring tests fail with the former search-index path; helper tests verify the independent read bounds and metadata preservation. The engine limit itself is established from the pinned Rust source above. No backend deployment or Playwright run is needed for these tests.
