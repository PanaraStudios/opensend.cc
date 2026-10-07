# Broadcast query read costs

Measured on 2026-10-06 on `perf/v2-broadcast-reads`, starting at
`fix/v2-pipeline-review`. Covers pipeline review R1, backend review F9,
and the broadcast recipients/history/metrics watch queries.

Run: `pnpm exec vitest run --config vitest.auth.config.ts convex/broadcastReadCosts.test.ts --maxWorkers=2`.
The convex-test fixture uses a real authenticated team, a WhatsApp broadcast
with 5,000 recipients, 100 recipients each on Messenger, Instagram and email,
and one contact with 300 additional messaging broadcast entries. Each broadcast
has one channel. Pages contain 100 rows; all messaging rows have message IDs
and contacts have primary identities. Only the aggregates used by these queries
are populated in the bulk fixture, in the source rows' transactions.

The test calls public queries via `ctx.runQuery` and reads
`ctx.meta.getTransactionMetrics()`. These are documents and encoded document
bytes read, including authorization and component reads, not response bytes
or a wall-clock latency benchmark. No production limit failure is claimed.

| Watch query | Before documents | Before bytes | After documents | After bytes |
| --- | ---: | ---: | ---: | ---: |
| Recipients: WhatsApp, 5k campaign | 405 | 135,645 | 205 | 73,755 |
| Recipients: Messenger | 405 | 136,247 | 205 | 74,157 |
| Recipients: Instagram | 405 | 136,247 | 205 | 74,157 |
| Recipients: email | 305 | 82,249 | 205 | 67,449 |
| Contact broadcast history: 100 distinct broadcasts/messages | 305 | 108,159 | 205 | 72,392 |
| Channel metrics: WhatsApp, 5k campaign | 132 | 161,720 | 132 | 161,720 |
| Channel metrics: Messenger | 60 | 52,432 | 60 | 52,432 |
| Channel metrics: Instagram | 60 | 52,432 | 60 | 52,432 |
| Channel metrics: email | 18 | 12,874 | 18 | 12,874 |

Before: messaging recipient pages read 100 recipient rows, 100 contacts,
100 messages and 100 primary identities, plus five authorization/broadcast
reads. History reads 100 recipients, 100 broadcasts and 100 messages, plus
five authorization/contact reads. Metrics already use aggregate trees instead
of recipient scans; their cost depends on tree depth and status ranges.

After: new recipient rows capture only five primary-identity display fields
at fan-out (or null for a known absence) and mirror the channel-message status.
The common message patch/delete writer updates that status in the same
transaction as the message and its counters; deleting a message writes null.
These internal fields are omitted from both query responses. Schema additions
are optional; there are no new indexes or migrations.

Full contacts and broadcasts remain current, including contact deletion,
phone, names, unsubscribe state and campaign edits. A new recipient's
primary-identity display is intentionally the fan-out snapshot; later identity
profile edits do not rewrite historical recipients. Legacy rows with omitted
fields use the current identity/message lookup. A null snapshot never triggers
a fallback. This avoids storing copies of full contact or broadcast documents.

For an actual returned page of P rows, new recipients cost P + distinct contacts
+ 5 documents; history costs P + distinct broadcasts + 5 (contact-ID filter).
Legacy fallbacks add at most one read per distinct message and primary contact
identity on that page. Fresh 100-row messaging recipient pages save 49.4% of
document reads and about 45.6% of bytes; history saves 32.8% of documents and
33.1% of bytes. Distinct broadcast reads remain necessary because the response
contains the complete current broadcast, not just its display name.

The regressions enforce nested transaction caps of 205 documents / 80,000 bytes
for new 100-row recipient/history pages; they measure later pages and exhaust
all 301 history entries without duplicates or omissions. Metrics are capped at
140 documents / 180,000 bytes for the 5k campaign and 65 documents for the small
campaigns. Metrics retain their aggregate-based implementation: logarithmic
tree reads, not per-recipient scans. The bytes here include aggregate nodes and
may vary with tree shape or document sizes on a real deployment.

Legacy rows with all unique keys still cost 405 documents for messaging
recipients and 305 for history. Fifty legacy rows mixed into a 100-row new page
cost 305 and 255 documents respectively. A 100-row legacy page repeating one
contact/message costs 108 documents for recipients; one broadcast/message costs
107 for history. Tests also cover live status changes (queued through failure,
including played), deletion, known-null identities, contact freshness, and
forwarding native pagination row/byte limits. Existing fan-out tests pin the
new fields for WhatsApp, Messenger, Instagram, and email writes.

QA host follow-up: compare live transaction metrics/latency for a newly sent
campaign and a pre-upgrade campaign, paginate recipients and contact history,
and verify queued/sent/delivered/read/failed status updates plus skip reasons.
This local measurement does not replace production profiling or browser/e2e
verification on the lead's host.

Validation in this worktree: `pnpm typecheck`, `pnpm lint`, `pnpm test`
(653 passed), `pnpm test:auth --maxWorkers=2` (1,278 passed), `pnpm test:sdk`
(627 passed), `pnpm test:mcp` (542 passed), and `pnpm build` all passed.
SDK/MCP scripts already set `--maxWorkers=2`. Lint retains one existing
`react-hooks/exhaustive-deps` warning in the calling softphone component,
outside this task's edit boundary. Four SDK live tests and one MCP live test
skip without the live origin/key environment. The browser e2e suite and calling
harness were not run: those are reserved for the lead's other host.
