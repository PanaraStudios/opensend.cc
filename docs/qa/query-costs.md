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
| Recipients: WhatsApp, 5k campaign | 405 | 135,645 | Pending | Pending |
| Recipients: Messenger | 405 | 136,247 | Pending | Pending |
| Recipients: Instagram | 405 | 136,247 | Pending | Pending |
| Recipients: email | 305 | 82,249 | Pending | Pending |
| Contact broadcast history: 100 distinct broadcasts/messages | 305 | 108,159 | Pending | Pending |
| Channel metrics: WhatsApp, 5k campaign | 132 | 161,720 | Pending | Pending |
| Channel metrics: Messenger | 60 | 52,432 | Pending | Pending |
| Channel metrics: Instagram | 60 | 52,432 | Pending | Pending |
| Channel metrics: email | 18 | 12,874 | Pending | Pending |

Before: messaging recipient pages read 100 recipient rows, 100 contacts,
100 messages and 100 primary identities, plus five authorization/broadcast
reads. History reads 100 recipients, 100 broadcasts and 100 messages, plus
five authorization/contact reads. Metrics already use aggregate trees instead
of recipient scans; their cost depends on tree depth and status ranges.
