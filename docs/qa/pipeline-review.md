# v2 messaging pipeline correctness review

Reviewed on 2026-10-06 in `fix/v2-pipeline-review`, starting at `d5bdf63`.
Read `CLAUDE.md` and `convex/_generated/ai/guidelines.md` first. Locations
below refer to the final code, at the site of the defect or remaining concern.
Severity describes impact; confidence describes the evidence.

## Scope and source history

Used `git log --oneline --first-parent v2` and the merge diffs for the original
pipeline, then traced their surviving implementations and called helpers in
this checkout. The available first-parent history has no PR #10 merge.

| PR | Merge | Relevant scope |
| --- | --- | --- |
| #8 | `ff11a61` | Meta app setup, phone contacts |
| #9 | `56332f4` | WhatsApp connections, inbound webhooks |
| #11 | `2f2c5f2` | Sends, templates, media, conversations, broadcasts, Pages, Instagram |
| #12 | `abfc145` | Simplified shared implementations |
| #13 | `f7b08de` | Automation channel steps |
| #14–#18 | `97bfe9c`, `de87f40`, `8724353`, `ea100bb`, `7e2c3ad` | Identified in history; calling/voice implementations excluded by task boundary |
| #19 | `9b3aea2` | Contact notes and deletion cleanup |

Reviewed Meta app/connection setup, inbound signature/ingest/projection,
message acceptance and worker claims, template/media send paths, receipt
projection, conversation windows and identities, email/WhatsApp/Messenger/
Instagram broadcast fan-out and settlement, automation dispatch/runtime and
channel steps, and customer webhook fan-out/attempts. The scope includes
current implementations of those paths, including later changes necessary
to understand their correctness.

## Findings

Every fixed finding below has a Convex regression observed failing against
the defective implementation and passing after its fix. No external Meta
account was used to manufacture local evidence.

| ID | Severity / confidence | Location | Concrete failing scenario | Resolution |
| --- | --- | --- | --- | --- |
| F1 | High / high | `convex/meta/projection.ts:254` | Meta rebundles a WhatsApp delivered/read observation in a different webhook body, or sends delivered after read. The message row retained its highest status, but duplicate/regressive timeline evidence, customer events and metrics were still emitted. | Fixed in `9d7aff8`: reject equal/lower milestones before any side effect. |
| F2 | High / high | `convex/meta/projection.ts:707`, `convex/meta/projection.ts:744` | A newer outbound Page/Instagram message is already read while an older one is still sent. A later watermark stopped at the newer row and never applied to the older message, including later pages. | Fixed in `9d7aff8`: skip already-advanced rows and continue watermark pagination. |
| F3 | High / high | `convex/webhooks.ts:569`, `convex/webhooks.ts:613` | A valid 600 KB event fans out to 30 customer endpoints in one mutation, exceeding an 8 MiB write budget. Reinvoking the consumer also creates duplicate delivery rows. | Fixed in `69ef03d`: paginate five listeners per transaction, persist cursor/completion, and fence stale/replayed continuations. |
| F4 | High / high | `convex/webhooks.ts:646` | Two workers claim the same attempt before either records a result. Both claims succeeded and both could POST the same attempt to the customer. | Fixed in `69ef03d`: an existing attempt-start marker rejects the second claim; completion still advances interrupted attempts through bounded retries. |
| F5 | High / high | `convex/meta/projection.ts:339`, `convex/meta/projection.ts:416`, `convex/meta/projection.ts:540` | A 60-message webhook performs all projection writes/reads in one transaction. It fails a 400-document read budget; repeated full delivery cannot make progress. | Fixed in `a92237e`: project ten items per transaction with a durable cursor and atomic continuation. Replay neither duplicates messages nor unread counts/events. The constrained test demonstrates scaling, rather than claiming 60 messages exceed the default production limit. |
| F6 | High / high | `convex/meta/projection.ts:77`, `convex/channels/messages.ts:100`, `convex/meta/connect.ts:235`, `convex/meta/connect.ts:368` | Twenty retained former owners of the same number/Page/Instagram account occupy the global lookup limit. The current owner then cannot ingest or resolve sends, and another team can pass the Page ownership precheck. | Fixed in `e4054ad`: filter live ownership through an index before limiting; resolve the team's retained account through a team-scoped index. |
| F7 | High / high | `convex/channels/messages.ts:679`, `convex/broadcastMetrics.ts:179` | A broadcast or automation queues a channel message, then its CRM recipient unsubscribes or is deleted before the worker claims it. WhatsApp/Messenger/Instagram still sent the queued message. | Fixed in `f059418`: recheck the live recipient at claim, including topic preferences, removed topics/segments and WhatsApp marketing preferences. An ineligible queued send fails and settles without calling Meta. |
| F8 | High / high | `convex/channels/mediaState.ts:28`, `convex/channels/mediaState.ts:70`, `convex/channels/media.ts:29` | An inbound media download loses its active connection or the worker throws before entering its download catch block. A direct scheduled action exits/fails, leaving the attachment pending indefinitely. | Fixed in `6f7171d`: use the existing durable channel pool and a failure completion callback; mark unavailable context terminal and cap retry delays at five retries (10/20/40/80/160 seconds). Successful completion remains idempotent. |
| F9 | High / high | `convex/channels/identity.ts:420`, `convex/channels/identity.ts:432` | A phone-less WhatsApp business identity already has threads on two sending numbers. A send response reveals a phone owned by an existing CRM contact. The identity and threads remained attached to the provisional contact, so events/history referred to the wrong customer. | Fixed in `5ab5b14`: reconcile with the existing phone owner immediately and relink all historical threads in bounded batches without refreshing their windows/previews. |
| F10 | Medium / high | `convex/audience.ts:561`, `convex/audience.ts:568` | Deleting a CRM contact leaves its channel identity and every conversation with a dangling `contactId`. The regression uses 61 threads, exceeding one cleanup batch. | Fixed in `6e2a535`: detach optional CRM links through the existing bounded contact purge while preserving channel history and preferences. |
| F11 | Medium / high | `convex/channels/payload.ts:213` | The newest reaction observation arrives first, then 101 older observations arrive late. Hydration took the latest 100 insertions before sorting timestamps, excluded the real latest observation, and displayed the old reaction. | Fixed in `788f13b`: index/order the bounded reaction page by provider observation time before applying its limit. |
| F12 | High / high | `convex/meta/connect.ts:721`, `convex/meta/connect.ts:746` | A Page connection has 500 retired Instagram endpoints plus its current endpoint, or a WhatsApp connection has 101 WABAs. Disconnect only handled the first 500 accounts/100 WABAs, leaving live ownership or WABA ownership behind. | Fixed in `3c4b31d`: process bounded account/WABA batches and reschedule until done; optional generation fences prevent old cleanup from modifying a reconnected connection. |
| F13 | Medium / high | `convex/meta/connect.ts:314` | Fifty former teams' connections precede the current team's connection for a Page business. Reconnect takes those first 50, misses its own row, and creates a duplicate connection. | Fixed in `d8b5677`: use the organization/business index before selecting the existing connection. |
| R1 | Medium / medium | `convex/broadcastWhatsApp.ts:419`, `convex/broadcastWhatsApp.ts:429` | Hydrating 100 broadcast recipients performs individual contact, channel-message and primary-identity reads. Busy teams incur hundreds of reads per page; crossing a production execution/byte limit was not reproduced. | Reported only. Profile this query on the QA host before changing its response or denormalizing data. This is related to, but distinct from, the recipient-history query in the earlier review. |
| R2 | High impact / medium | `convex/channels/deliver.ts:27`, `convex/channels/deliver.ts:76`, `convex/channels/messages.ts:911` | Meta accepts a send, then the worker dies before saving the returned provider message ID. The durable callback ends the local send as failed, although the recipient may have received it. Retrying an ambiguous POST could duplicate delivery. | Reported only. Current code deliberately avoids resending an ambiguous outcome. Local mocks cannot establish remote acceptance or a safe provider reconciliation mechanism; verify with controlled provider failures. |
| R3 | Low / low | `convex/meta/projection.ts:49`, `convex/meta/projection.ts:58` | External message-ID lookup caps global candidates at ten before selecting the account. Ten same-ID rows on other accounts could hide a matching message. This requires historical duplicate/colliding provider IDs; reachability through normal provider traffic was not established. | Reported only. Do not infer a normal Meta collision from a fabricated database fixture. An account-scoped index is a possible follow-up if production evidence supports it. |

## Regression evidence

The fixes add 26 test cases. Existing tests were retained and updated where
they assumed duplicate receipt evidence or direct scheduler implementation
details. Media tests now drain the worker and assert downloads/results.

| Finding | Convex regression |
| --- | --- |
| F1 | `convex/metaInbound.test.ts:113`: rebundled/reordered milestones emit once. |
| F2 | `convex/pageMessaging.test.ts:102`: both Page channels reach the older sent row. |
| F3 | `convex/webhooks.test.ts:86`: 30 endpoints and a 600 KB payload obey the write budget, drain completely, and replay once. |
| F4 | `convex/webhooks.test.ts:115`: second claim is refused; interruption advances the retry generation. |
| F5 | `convex/metaInbound.test.ts:140`: 60 items obey a constrained transaction budget; drain and replay preserve exactly 60 messages/events/unread count. |
| F6 | `convex/pipelineAccounts.test.ts:29`: all three channels route past twenty historical owners; Page takeover is refused and reconnect reuses the account. |
| F7 | `convex/broadcastPageChannels.test.ts:103`, `convex/whatsappCampaigns.test.ts:164`: unsubscribe/deletion before claim on all three channels. `convex/automationPageChannels.test.ts:132`, `convex/whatsappCampaigns.test.ts:711`: queued automation unsubscribe on all three channels. |
| F8 | `convex/metaInbound.test.ts:178`: unavailable connection and interruption before download both end with attachment errors after draining bounded retries. |
| F9 | `convex/metaInbound.test.ts:216`: response-learned phone uses the existing CRM owner in the sent event and both threads. |
| F10 | `convex/contactHistory.test.ts:28`: deletion detaches all 61 threads and the identity while retaining history. |
| F11 | `convex/metaInbound.test.ts:300`: 101 delayed older reactions cannot displace the latest observation. |
| F12 | `convex/pipelineAccounts.test.ts:105`, `convex/pipelineAccounts.test.ts:145`: disconnect exhausts retained endpoint history and more than 100 WABAs. Existing Page reconnect/unsubscribe fencing tests also pass. |
| F13 | `convex/pipelineAccounts.test.ts:177`: reconnect finds its existing connection after fifty former owners. |

## Other reviewed behavior

No additional high-confidence window/template defect was reproduced. Window
arithmetic uses epoch milliseconds and rejects the exact expiry boundary
(`windowExpiresAt <= now`). Queue claims recheck that boundary. WhatsApp
free-form sends require the open window; template sends validate the selected
template. Automated Page/Instagram steps and broadcasts do not supply a
HUMAN_AGENT exception; the manual tag path enforces its seven-day boundary.
This review verifies the implemented guards, not live Meta policy approval.

Inbound external IDs already suppress normal message/reaction replay before
unread counts and automation/customer events. Unknown early statuses use
bounded independent retries. Broadcasts already page ten contacts, rotate
workflow journals, fence generations and settle through completion/timer
paths. Automation dispatch/run completion and wait paths use bounded jobs.
Outgoing media upload requests return a result/error rather than persisting
an unowned pending job; uploaded-file pruning reschedules batches. Template
deletion and account disconnect preserve message history. Email broadcast
claims already rechecked recipient eligibility; F7 aligns channel claims.

## Checks and short report

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm lint` | Passed, zero errors. One existing warning at `components/dashboard/calling/softphone-provider.tsx:117` for the `phone` effect dependency; excluded component untouched. |
| `pnpm test` | Passed: 653 tests, 117 suites. |
| `pnpm test:auth --maxWorkers=2` | Passed: 1,272 tests, 81 files. |
| `pnpm test:sdk` | Passed: 627 tests; four live tests skipped by the suite. |
| `pnpm test:mcp` | Passed: 542 tests; one live test skipped by the suite. |
| `pnpm build` | Passed: production compilation, TypeScript and all 58 static pages. |

Thirteen reproduced findings were fixed in eleven small code commits, listed
above. Validation follow-up `bdc60ab` checks webhook signing-secret expiry on
a fresh delivery: the first full Convex run exposed an existing test that
claimed the same attempt twice, which F4 now correctly refuses. Three concerns
remain reported. Public REST/SDK/MCP shapes stay
compatible; schema additions are optional progress/generation fields and new
indexes. No historical data migration was performed: existing duplicates,
completed orphan cleanup, or already-stuck downloads need separate repair if
present. On a known large deployment, stage/backfill new indexes before
activating the dependent queries, following the Convex deployment guidance.

No excluded components/services/scripts/container configuration/SDK/MCP code,
calling/voice/IVR implementation or security helper was edited. No package
scripts were changed, and no push, deployment, `convex dev`, e2e suite or
calling harness was run. PR #10 was absent from the available merge history.
The e2e suite and calling harness are reserved for the lead on the other host.
The requested unit command includes fake-Graph harness *unit tests*; these do
not invoke the browser e2e suite or calling harness.

The lead should verify on the browser/e2e host:

- Connect/reconnect WhatsApp, a Facebook Page and Instagram; disconnect and
  reconnect while cleanup is pending. Confirm ownership is freed, old jobs
  cannot retire the reconnect, and history is preserved.
- Replay/rebundle inbound messages, reactions and delivered/read callbacks;
  confirm one inbox message/automation/customer event per observation and
  monotonic receipts, including a watermark over previously read rows.
- Queue broadcasts and automation steps on all channels, then unsubscribe or
  delete recipients before send. Confirm no channel POST, terminal recipient
  state and final campaign/run settlement. Check ordinary email broadcasts too.
- Exercise exact 24-hour expiry, WhatsApp templates outside the window, and
  manual Page/Instagram HUMAN_AGENT boundaries; automated sends must not use
  the exception.
- Interrupt media workers or invalidate a connection during download; confirm
  bounded retries and a visible terminal attachment error. Verify uploads and
  successful downloads still render.
- Learn a WhatsApp business identity's phone after threads exist on multiple
  numbers, then delete its CRM contact; confirm correct attribution and
  preserved channel history after background cleanup.
- Deliver large webhook batches/events to multiple customer endpoints, replay
  the consumers, and verify durable fan-out exhaustion. Measure R1 query cost
  and investigate R2 using controlled provider acceptance/record failures.
