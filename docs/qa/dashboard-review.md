# v2 dashboard quality review

Reviewed on 2026-10-05 in `fix/v2-dashboard-review`, parent `d5bdf63`.
This clone has no `origin/master` ref. The review covered the v2 dashboard
areas named in the task: messages, channels, contacts, templates, broadcasts,
automations and flows, playground, webhooks, API keys, metrics, and settings.
`lib/` files that only import `convex/` were left out. `CLAUDE.md` was read
first. No `convex/` edit was required, so `convex/_generated/ai/guidelines.md`
was not applied to a code change.

Locations below are the final code. Severity is impact. Confidence is how
directly the code shows the failure.

## Findings

| ID | Severity / confidence | Location | What happens | Resolution |
| --- | --- | --- | --- | --- |
| F1 | High / high | `components/dashboard/emails/detail.tsx:162`, `lib/dashboard/format.ts:119` | A channel timeline event such as `payment_updated` or `read_receipt_failed` was passed through `sentenceCase`, which keeps the underscore. The timeline showed `Payment_updated`. | Fixed in `fcb804c`. `timelineEventLabel` keeps email statuses on `emailStatusLabel` and spells channel events. Tested in `lib/dashboard/format.test.ts`. |
| F2 | High / high | `components/dashboard/calling/calls-view.tsx:121` | An outbound call with outcome `no_answer` or `answered` rendered the stored code with underscores removed, so the cell read `no answer`. | Fixed in `0a90a45` and `32b6078`. The list uses `callOutcomeLabel`, which now includes `answered`. Outbound outcome still wins over bot and IVR outcome. Tested in `lib/dashboard/voice-playground.test.ts`. |
| F3 | High / high | `components/dashboard/playground/call-detail.tsx:67` | When bot and IVR outcomes were absent, the outcome cell called `ivrActionLabel(null)` and showed a dash, even when `outcome` or `status` was set. | Fixed in `32b6078`. The detail falls through to the dial outcome, then the call status. |
| F4 | High / high | `lib/dashboard/voice-playground.ts:46`, `components/dashboard/playground/tester.tsx:53` | A bot IVR action rendered `Bot:` plus the Convex bot id. | Fixed in `0a90a45` and `32b6078`. The label is `Voice bot`. The tester path uses that helper. Test updated. |
| F5 | High / high | `components/dashboard/calling/call-with-bot.tsx:137`, `components/dashboard/calling/call-with-bot.tsx:185` | Calling permission replaced underscores and showed `unknown` or `no permission`. | Fixed in `0a90a45` and `32b6078`. `callPermissionLabel` maps the stored statuses. Empty and `unknown` read `Not checked`. Tested in `lib/dashboard/voice-playground.test.ts`. |
| F6 | High / high | `components/dashboard/calling/softphone-provider.tsx:235`, `lib/meta/softphone.ts:54` | The offer clock started at `0` and the first tick waited a second. `offeredAt + 60000 > 0` is true for every offer, so a stale ringing call could start the ring on load. | Fixed in `6158dfc` and `32b6078`. `offerIsFresh` requires a known clock. The existing effect sets the clock immediately, then every second. Tested in `lib/meta/softphone.test.ts`. |
| F7 | High / high | `components/dashboard/calling/calls-view.tsx:59`, `lib/meta/softphone.ts:68` | The agent badge compared `availableUntil` with a clock that stayed `0` for up to five seconds, so an expired agent looked available, and the badge printed the raw status `online`. | Fixed in `6158dfc` and `32b6078`. The clock ticks immediately. `agentPresenceLabel` prints `Online` or `Away`, and treats an expired lease as away once the clock is known. |
| F8 | Medium / high | `components/dashboard/channels/shared.tsx:187` | The channel page filter rebuilt the same option list as the message filters. | Fixed in `de2d2e1`. `CHANNEL_FILTER_ITEMS` is `MESSAGE_CHANNEL_ITEMS`. Order stays email first. |
| F9 | Medium / high | `components/dashboard/conversation/send-message-action.tsx:36` | The send dialog hardcoded channel labels beside `lib/channels.ts`. | Fixed in `de2d2e1`. Labels come from `CHANNELS`. The dialog stays WhatsApp first. |
| F10 | High / high | `components/dashboard/audience/contact-detail.tsx:420` | The topic subscription switch had no accessible name. The contact-level subscribed switch on the same page is named. | Fixed in `ec75bbc`. The switch is named `Subscribe` or `Unsubscribe` plus the topic name. |
| F11 | High / high | `components/dashboard/playground/knowledge.tsx:240` | A knowledge base loaded documents with `limit: 100` and dropped `has_more`. Document 101 and later never appeared, and the page gave no way to reach them. | Fixed in `d9efb26`. Documents use the same 25-row id cursor as the knowledge base list. The cursor helpers are in `lib/dashboard/pagination.ts` and tested in `lib/dashboard/pagination.test.ts`. Changing knowledge base resets the cursor. A single page hides the pager. The knowledge base list used to keep disabled Previous and Next on a short list. |
| F12 | High / high | `components/dashboard/playground/inbox.tsx:87` | On a narrow screen, opening a thread unmounted the conversation list. Search, channel, status, and the loaded page reset when the user went back. | Fixed in `26db145`. The list stays mounted and is hidden while the thread is open. |
| F13 | High / high | `components/dashboard/calling/calls-view.tsx:117`, `lib/dashboard/voice-playground.ts:107` | A call with a bot or IVR id and no name rendered `Bot ` or `IVR ` with a trailing space. | Fixed in `0a90a45` and `32b6078`. `callRouteLabel` uses the name when it is present, otherwise `Voice bot` or `IVR`. Tested in `lib/dashboard/voice-playground.test.ts`. |

## Reported, unchanged

| ID | Severity / confidence | Location | What happens |
| --- | --- | --- | --- |
| R1 | Medium / high | `components/dashboard/playground/bot-tool-fields.tsx:42`, `components/dashboard/playground/bot-tool-fields.tsx:47`, `components/dashboard/playground/ivr.tsx:346`, `components/dashboard/playground/ivr-fields.tsx:300`, `components/dashboard/playground/voice-bots.tsx:265`, `components/dashboard/playground/voice-bots.tsx:570`, `components/dashboard/playground/provider-keys.tsx:192`, `components/dashboard/playground/provider-keys.tsx:228`, `components/dashboard/calling/calls-view.tsx:38` | These pickers and name lookups request `limit: 100` and ignore `has_more`. A saved bot, IVR, knowledge base, tool, or provider key past that page disappears from the picker while it remains in the saved config. Including the selected ids needs a query change. |
| R2 | Medium / high | `components/dashboard/automations/events.tsx:66` | The custom event field type menu labels the stored values `string`, `number`, `boolean`, and `date`. Audience property types on the properties page use `String` and `Number`. |
| R3 | Medium / high | `components/dashboard/playground/call-detail.tsx:105`, `components/dashboard/conversation/business-card.tsx:395`, `components/dashboard/conversation/message-content.tsx:125` | Collected call keys, WhatsApp order status, and form reply keys drop underscores and stay lowercase, so `payment_updated` reads `payment updated`. |
| R4 | Medium / high | `components/dashboard/conversation/message-content.tsx:136`, `lib/dashboard/conversation-content.ts:30` | A call permission reply prints the stored `response` value in the thread and in the text fallback. |
| R5 | Medium / high | `lib/dashboard/voice-playground.ts:44` | A submenu action still reads `Menu:` plus the menu slug. The IVR tester path resolves the menu name. Outcome badges still use the slug. |
| R6 | Medium / medium | `components/dashboard/audience/contact-detail.tsx:531` | Broadcast history prints `subject`, then ` · `, then the date. An empty subject leaves a leading separator. |
| R7 | Medium / high | `components/dashboard/calling/calls-view.tsx:73`, `components/dashboard/channels/calling.tsx:537` | An empty page replaces the table and pager with `No calls yet`. If the only rows on a later page disappear, Previous is gone until reload. The knowledge lists keep Previous in that case. |
| R8 | Low / medium | `components/dashboard/emails/detail.tsx:516`, `components/dashboard/emails/detail.tsx:594` | `JSON.parse` runs on message payload and on failed receipt or typing details. Those values are written with `JSON.stringify`. A corrupt stored string would throw and take down the page. |
| R9 | Low / high | `lib/dashboard/conversation-content.ts:40`, `lib/dashboard/format.ts:35` | `relativeMessageTime` overlaps `formatRelative` and uses different rules. `convex/voice/callerContext.ts` calls the message helper, so the two stay separate. |
| R10 | Medium / high | `components/dashboard/channels/calling.tsx:562` | Channel call log rows show the contact name as text. The playground call list links each row to `/playground/calls/[id]`. |
| R11 | Low / high | `components/dashboard/calling/calls-view.tsx:140`, `components/dashboard/channels/calling.tsx:614` | Previous and Next for id cursors are still written out on the call lists. Knowledge uses `cursorNext` and `cursorPrevious`. |
| R12 | Low / high | `components/dashboard/calling/softphone-provider.tsx:119` | ESLint already warns that the phone effect omits `phone`. This change did not add that effect. The warning remains. |

## Tests

| Finding | Test |
| --- | --- |
| F1 | `lib/dashboard/format.test.ts` `timelineEventLabel` |
| F2, F4, F5, F13 | `lib/dashboard/voice-playground.test.ts` |
| F6, F7 | `lib/meta/softphone.test.ts` |
| F11 | `lib/dashboard/pagination.test.ts` `id cursors` |

F3, F8, F9, F10, and F12 are component structure. This repo's dashboard unit tests cover `lib/` helpers. No e2e file was edited. `tests/e2e/softphone-flow.ts` looks for the button name `Go online`, which is unchanged.

## Checks

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed. |
| `pnpm lint` | Passed with zero errors. One existing warning at `components/dashboard/calling/softphone-provider.tsx:119`. |
| `pnpm test` | 657 passed, 119 suites. |
| `pnpm test:auth --maxWorkers=2` | 1,246 passed, 80 files. |
| `pnpm test:sdk` | 627 passed, 4 live tests skipped. |
| `pnpm test:mcp` | 542 passed, 1 live test skipped. |
| `pnpm build` | Passed. |

Thirteen findings were fixed in eight commits. Twelve findings are reported and unchanged. Public routes, test ids, and REST, SDK, and MCP shapes are unchanged. No schema change, package script edit, `convex/` edit, e2e edit, push, or `convex dev` run.

## What the lead should verify

Browser and the Playwright e2e suite were not run here. The calling harness was not run.

- A WhatsApp timeline shows `Payment updated`, `Read receipt failed`, and `Typing failed`, and an email `delivery_delayed` event still reads `Delayed`.
- The calls list shows `Answered` and `No answer` for outbound dial outcomes, `Voice bot` or `IVR` when the name is missing, and agent badges `Online` or `Away`.
- A call detail with a dial outcome and no bot or IVR outcome shows that dial outcome.
- Calling permission reads `Not checked` before a check and `No permission` when that is the stored status.
- Loading the softphone does not ring an offer older than 60 seconds. A fresh offer still rings after the clock starts. Transfer targets exclude an expired presence lease.
- A knowledge base with more than 25 documents pages forward and back. Opening another knowledge base starts at its first page.
- The topic subscription switch exposes `Subscribe` or `Unsubscribe` plus the topic name.
- Channel filters stay email first. The send dialog stays WhatsApp first, with Email, WhatsApp, Messenger, and Instagram labels.
- At 390px, opening a playground inbox thread and going back keeps the search text, channel, status, and page. The touched screens stay within the viewport in light and dark.
