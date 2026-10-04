# v2 backend correctness review

Reviewed on 2026-10-04 in `fix/v2-backend-review`, based on fetched `origin/v2`
at `78053bbc44f477b5777321af55ac051a2c619ed1`. Read `CLAUDE.md` and
`convex/_generated/ai/guidelines.md` before reviewing or editing code.

Scope was selected with `git log --since=2026-10-01 --name-only -- convex lib`
and the v2 merge history, then compared against `9b3aea2`, before PR #20.
The available history contains PRs #20–#28. PRs #29–#30 are absent from the
fetched v2 branch and could not be reviewed. The review covered the changed
backend and its called helpers for automation events/catalog, unified messages,
Channels queries, bot toolkit/knowledge/embeddings/collection/webhooks,
transcripts/caller lookup, outbound calls/permissions, presence/leases, and
webhook fixes. The two queries called out by QA were also inspected.

## Findings

Locations below refer to the final code; each identifies the site of the
original defect or the remaining concern. Severity describes impact;
confidence describes the supporting evidence.

| ID  | Severity / confidence | Location                                                                                                | Concrete failing scenario                                                                                                                                                                                                                                                                            | Resolution                                                                                                                                                                                                                                                                                                        |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | High / high           | `convex/api/messages.ts:109`, `convex/api/messages.ts:264`                                              | `GET /messages?channel=email&direction=outbound&limit=100` over 21 emails with valid 850,000-character bodies previously returned all 21 in one page. Pagination budgeted only lightweight email rows, then hydration read over 17 MB of bodies, exceeding the query read limit.                     | Fixed in `17a303e`. Hydrate during stream iteration and charge the complete response representation to the byte budget, preserving cursor keys. The test now exhausts all messages in order, with at most two large messages per page and no duplicates or omissions.                                             |
| F2  | High / high           | `convex/automationRuntime.ts:873`, `convex/automationRuntime.ts:884`, `convex/automationRuntime.ts:946` | A `contact.deleted` automation recreated the deleted address through email fallback/upsert. Separately, an email event queued before contact deletion could attach its run to a newly created contact at the same address, allowing subsequent effects to target the replacement.                    | Fixed in `6e99e75`. Normalize contact-event `data.id` and treat a known contact ID as authoritative after deletion. System events retain their payload and may execute without a live contact; email lookup/upsert cannot replace that identity. Two regression tests cover resurrection and replacement binding. |
| F3  | Medium / high         | `convex/automations.ts:212`, `convex/automations.ts:265`, `convex/automationEvents.ts:381`              | Saving/enabling a two-event graph scanned every unrelated custom event definition. With 200 unrelated definitions, the regression fails under a 100-document transaction limit; as the catalog grows, a tiny graph can hit production transaction limits.                                            | Fixed in `6e99e75`. Resolve only trigger and nested wait-event names using the existing exact-name index. Save and enable both pass the constrained test, including schema validation of references to both events.                                                                                               |
| F4  | Medium / high         | `convex/calling/outboundState.ts:280`, `convex/calling/outboundState.ts:311`                            | A place-call step with purpose `Follow up with {{trigger.first_name}}` and a variable from `{{steps.profile.contact.first_name}}` recorded correctly resolved step inputs but placed the call with missing values. A second resolver supplied only `event` and `contact`.                            | Fixed in `1edb16b`. Use the prepared running step's durable resolved inputs and retain the live contact/unsubscribe check. Regression verifies one completed call with both the original trigger name and the preceding update's output.                                                                          |
| F5  | Medium / high         | `convex/calling/softphoneState.ts:59`                                                                   | An online browser refreshed credentials on the same lease, changing `updatedAt` without scheduling a replacement presence expiry. If heartbeats then stopped, the last scheduled expiry saw a different timestamp and returned, leaving presence online and skipping its credential-revocation path. | Fixed in `81525e1`. Preserve the presence timestamp when reusing the lease. The pending expiry still takes the agent away after credential refresh and stopped heartbeats.                                                                                                                                        |
| F6  | Medium / high         | `convex/voice/toolkitState.ts:85`, `convex/voice/toolkitState.ts:119`, `convex/voice/gateway.ts:514`    | A call answered 20 seconds ago and transferred to a bot 10 seconds ago logged a tool at 10 seconds instead of 20. Tool and completion rows also omitted `timeline: "call"`, mixing their time origin with normalized transcript rows.                                                                | Fixed in `50be159`. Share the existing call-origin timestamp helper and tag both new rows with the call timeline. Regression verifies 20,000 ms for the tool and 20,250 ms for its completion. Historical rows are not backfilled.                                                                                |
| F7  | Medium / high         | `convex/calling/playgroundState.ts:31`, `convex/calling/playgroundState.ts:37`                          | A connected WhatsApp number created after 100 Messenger/disconnected accounts was omitted from setup: the query took 100 organization accounts before selecting eligible numbers.                                                                                                                    | Fixed in `b27e8d4`. Use the existing organization/channel/disconnection index before the limit. Regression verifies that unrelated accounts neither occupy the number limit nor appear in the result.                                                                                                             |
| F8  | Medium / high         | `convex/automationEvents.ts:394`, `convex/automationEvents.ts:399`, `convex/api/events.ts:57`           | The dashboard catalog and REST `/events/catalog` still collect and return every custom definition as one array. A team with 8,192 custom definitions plus the built-in events exceeds Convex's 8,192-element array limit; sufficiently large schemas can hit byte limits sooner.                     | Reported, unchanged. F3 removes this scan from saves/enables. Completing the catalog fix requires a paginated catalog contract and updates to its UI consumers; silently truncating would lose schemas, and changing the existing REST shape is outside this task.                                                |
| F9  | Medium / medium       | `convex/broadcasts.ts:553`, `convex/broadcasts.ts:557`                                                  | A history page of 100 recipients with message IDs reads 100 broadcasts and 100 channel messages in addition to pagination. Under load this amplifies the query latency that QA saw near one second.                                                                                                  | Reported, unchanged. The N+1 reads are certain; crossing the server execution limit at ordinary page sizes was not reproduced locally. Profile this path on the QA host before selecting a root fix.                                                                                                              |
| F10 | Medium / medium       | `convex/calling/playgroundState.ts:45`, `convex/calling/playgroundState.ts:49`                          | After F7, setup for 100 eligible WhatsApp accounts still performs 100 separate calling-settings lookups. It also retains the existing 100-number result cap. This leaves the QA latency concern unresolved for teams with many eligible accounts.                                                    | Reported, unchanged beyond F7. No local server execution-time reproduction. Measure settings lookup cost on the QA host; expanding the number picker beyond its cap requires a UI pagination change.                                                                                                              |

## Regression evidence

Each added Convex regression was run against the defective implementation and
failed before its corresponding fix. All pass after the fixes.

| Finding | Convex-test regression                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | `convex/api/messages.test.ts:424` — large bodies obey the hydration budget and exhaust cursors without loss.                           |
| F2      | `convex/automationEventCatalog.test.ts:145` and `:192` — deleted contacts stay deleted; delayed events cannot bind replacements.       |
| F3      | `convex/automationEventCatalog.test.ts:77` — saving/enabling succeeds with a strict document-read limit despite unrelated definitions. |
| F4      | `convex/calling.test.ts:1697` — outbound calls use trigger and prior-step resolved values.                                             |
| F5      | `convex/softphone.test.ts:635` — credential refresh cannot cancel the last presence expiry.                                            |
| F6      | `convex/botToolkit.test.ts:675` — transferred-bot tool and completion timestamps use the call origin.                                  |
| F7      | `convex/playground.test.ts:65` — eligible numbers survive unrelated account history.                                                   |

## Checks and report

| Command                         | Final result                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                | Passed.                                                                                                                                                            |
| `pnpm lint`                     | Passed with zero errors. One existing warning at `components/dashboard/calling/softphone-provider.tsx:117` for the `phone` effect dependency; component untouched. |
| `pnpm test`                     | 619 passed, 117 suites.                                                                                                                                            |
| `pnpm test:auth --maxWorkers=2` | 1,223 passed, 79 files.                                                                                                                                            |
| `pnpm test:sdk`                 | 535 passed; four live tests skipped.                                                                                                                               |
| `pnpm test:mcp`                 | 535 passed; one live test skipped.                                                                                                                                 |

Seven high-confidence findings were fixed in six code commits, with eight new
Convex-test regressions. Three remaining findings are reported above. No
high-confidence cross-team authorization, API-scope, signature/lease validation,
or secret-disclosure defect was found in the reviewed changes. Existing tests
for tenant isolation, scoped routes, signed gateway callbacks, permission
replays, tool reservation before external I/O, and cleanup passed.

Public REST/SDK shapes are preserved; message pages may be shorter to respect
the existing pagination budget. No schema changes, component edits, package
script edits, deployment, push, `convex dev`, e2e run, or calling-harness run
were performed. Local Convex-test timing is not a production one-second-limit
benchmark; F9/F10 require measurements on the other host. PRs #29–#30 remain
outside the available source history.
