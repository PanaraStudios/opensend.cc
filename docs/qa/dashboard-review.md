# v2 dashboard quality review

Reviewed on 2026-10-05 in `fix/v2-dashboard-review`, parent `d5bdf63`.
The medium follow-up is `fix/v2-dashboard-review-2`, starting at `cdf7cd8`.
This clone has no `origin/master` ref. The review covered the v2 dashboard
areas named in the task: messages, channels, contacts, templates, broadcasts,
automations and flows, playground, webhooks, API keys, metrics, and settings.
`lib/` files that only import `convex/` were left out of the first pass.
`CLAUDE.md` was read first. The follow-up reads
`convex/_generated/ai/guidelines.md` before the picker queries.

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

## Follow-up on `fix/v2-dashboard-review-2`

Medium items with a shared root-cause fix are marked fixed below. The rest stay reported.

| ID | Severity / confidence | Location | What happens | Resolution |
| --- | --- | --- | --- | --- |
| R1 | Medium / high | `components/dashboard/playground/bot-tool-fields.tsx`, `components/dashboard/playground/ivr.tsx`, `components/dashboard/playground/ivr-fields.tsx`, `components/dashboard/playground/voice-bots.tsx`, `components/dashboard/playground/provider-keys.tsx`, `components/dashboard/calling/calls-view.tsx`, `components/dashboard/calling/place-call-fields.tsx` | These pickers and name lookups requested `limit: 100` and ignored `has_more`. A saved bot, IVR, knowledge base, tool, or provider key past that page disappeared from the picker. The place-call route loaded pages of 50 with Load more. The provider key table stopped at 100 rows. | Fixed in `daf8cdf`. `convex/pickerOptions.ts` searches a name or label index and point-reads up to 64 saved ids. `components/dashboard/resource-picker.tsx` is the shared select and checklist. The provider key table pages 25 rows with the cursor helpers. `90b5ced` lists the two place-call setters as the search callback dependencies. Tested in `convex/pickerOptions.test.ts` and `lib/dashboard/options.test.ts`. |
| R2 | Medium / high | `components/dashboard/automations/events.tsx`, `components/dashboard/audience/properties.tsx`, `components/dashboard/automations/references.tsx` | The custom event field type menu labeled the stored values `string`, `number`, `boolean`, and `date`. Reference descriptions showed the same codes. Property types relied on CSS capitalize. | Fixed in `423b903`. `fieldTypeLabel` in `lib/dashboard/format.ts` is the one map. Tested in `lib/dashboard/format.test.ts`. |
| R3 | Medium / high | `components/dashboard/playground/call-detail.tsx`, `components/dashboard/conversation/business-card.tsx`, `components/dashboard/conversation/message-content.tsx` | Collected call keys, WhatsApp order status, and form reply keys dropped underscores and stayed lowercase, so `payment_updated` read `payment updated`. | Fixed in `423b903`. Those labels use `codeLabel`, which sentence-cases the code and keeps the rest of each word. Tested in `lib/dashboard/format.test.ts`. |
| R4 | Medium / high | `components/dashboard/conversation/message-content.tsx`, `lib/dashboard/conversation-content.ts` | A call permission reply printed the stored `response` value in the thread and in the text fallback. | Fixed in `423b903`. `callPermissionReplyLabel` maps `accept` to Accepted and `reject` to Declined. Tested in `lib/dashboard/voice-playground.test.ts` and `lib/dashboard/conversation-content.test.ts`. |
| R5 | Medium / high | `lib/dashboard/voice-playground.ts` | A submenu action read `Menu:` plus the menu slug. Outcome badges used that slug. | Fixed in `423b903`. `ivrActionLabel` takes the menus when the caller has them and shows `Menu:` plus the menu name. Without a name it shows Submenu. The call detail passes the loaded IVR menus. The tester path still resolves the name itself. Tested in `lib/dashboard/voice-playground.test.ts`. |
| R6 | Medium / medium | `components/dashboard/audience/contact-detail.tsx` | Broadcast history printed `subject`, then ` · `, then the date. An empty subject left a leading separator. | Fixed in `d10f403`. The line joins the trimmed subject and the date when each one is present. |
| R7 | Medium / high | `components/dashboard/calling/calls-view.tsx`, `components/dashboard/channels/calling.tsx` | An empty page replaced the table and pager with `No calls yet`. If the only rows on a later page disappeared, Previous was gone until reload. | Fixed in `ce21d8b`. `cursorListIsEmpty` is true only when the list itself is empty. `cursorPagerVisible` keeps Previous when history exists. The same check is used on the voice bot, IVR, webhook tool, knowledge, and provider key lists. Tested in `lib/dashboard/pagination.test.ts`. |
| R11 | Low / high | `components/dashboard/calling/calls-view.tsx`, `components/dashboard/channels/calling.tsx` | Previous and Next for id cursors were written out on the call lists. | Fixed in `ce21d8b`. Both call lists use `cursorPrevious` and `cursorNext`. |

## Reported, unchanged

| ID | Severity / confidence | Location | What happens | Why it stays reported |
| --- | --- | --- | --- | --- |
| R8 | Low / medium | `components/dashboard/emails/detail.tsx` | `JSON.parse` runs on message payload and on failed receipt or typing details. A corrupt stored string would throw and take down the page. | The stored values are written with `JSON.stringify`. Guarding the parse is defensive, and this lane did not find a corrupt payload to fix at the source. |
| R9 | Low / high | `lib/dashboard/conversation-content.ts`, `lib/dashboard/format.ts` | `relativeMessageTime` overlaps `formatRelative` and uses different rules. | `convex/voice/callerContext.ts` calls the message helper. Collapsing the two would change caller-context wording, so they stay separate. |
| R10 | Medium / high | `components/dashboard/channels/calling.tsx` | Channel call log rows show the contact name as text. The playground call list links each row to `/playground/calls/[id]`. | This is a product difference between the channel log and the playground, not one broken lookup. Linking the channel log needs a product decision. |
| R12 | Low / high | `components/dashboard/calling/softphone-provider.tsx:119` | ESLint warns that the phone effect omits `phone`. | The warning was already there. This lane did not add that effect. |

## Tests

| Finding | Test |
| --- | --- |
| F1 | `lib/dashboard/format.test.ts` `timelineEventLabel` |
| F2, F4, F5, F13 | `lib/dashboard/voice-playground.test.ts` |
| F6, F7 | `lib/meta/softphone.test.ts` |
| F11 | `lib/dashboard/pagination.test.ts` `id cursors` |
| R1 | `convex/pickerOptions.test.ts`, `lib/dashboard/options.test.ts` |
| R2, R3 | `lib/dashboard/format.test.ts` `readable codes` |
| R4, R5 | `lib/dashboard/voice-playground.test.ts`, `lib/dashboard/conversation-content.test.ts` |
| R7, R11 | `lib/dashboard/pagination.test.ts` `keeps Previous when the current page has no rows` |

F3, F8, F9, F10, and F12 are component structure. This repo's dashboard unit tests cover `lib/` helpers. No e2e file was edited. `tests/e2e/softphone-flow.ts` looks for the button name `Go online`, which is unchanged.

## Checks

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed on the final tree. |
| `pnpm lint` | Passed with zero errors. One existing warning at `components/dashboard/calling/softphone-provider.tsx:119`. |
| `pnpm test` | 661 passed, 120 suites. |
| `pnpm test:auth --maxWorkers=2` | 1,247 passed, 81 files. |
| `pnpm test:sdk` | 627 passed, 4 live tests skipped. |
| `pnpm test:mcp` | 542 passed, 1 live test skipped. |
| `pnpm build` | Passed. The build also typechecked the project. |

F1 through F13 were fixed on `fix/v2-dashboard-review`. This follow-up fixes R1, R2, R3, R4, R5, R6, R7, and R11 in `ce21d8b`, `daf8cdf`, `423b903`, `d10f403`, and `90b5ced`. R8, R9, R10, and R12 stay reported. Public routes, test ids, and REST, SDK, and MCP shapes are unchanged. The schema adds unstaged search indexes on voice bots, provider keys, IVRs, knowledge bases, and webhook tools, so the options queries work in the same deploy. Convex backfills those indexes before the deploy finishes, and a large table can hold the deploy until the backfill completes. No package script edit, e2e edit, push, or `convex dev` run.

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
- Search reaches a voice bot, IVR, knowledge base, webhook tool, or provider key past the first page, and a saved attachment past that page stays checked. The provider key table pages 25 rows. An emptied later page still shows Previous on that table and on the voice bot, IVR, tool, and knowledge lists.
- Place a call searches voice bots and IVRs from one field.
- The calls list and the channel call log keep Previous when the current page has no rows.
- Automation field types read String, Number, Boolean, and Date. Property types use the same labels. A reference for enum, object, or array reads Choice, Object, or List.
- Collected call keys, WhatsApp order status, and form reply keys sentence-case the stored code. `payment_updated` reads Payment updated. `First_Name` reads First Name.
- A call permission reply reads Accepted or Declined.
- A submenu outcome reads Menu plus the menu name, or Submenu when that name is not loaded.
- Broadcast history with an empty subject shows the date and no leading separator.
- At 390px, in light and dark, the new pickers and attachment switches stay inside the viewport with no horizontal page scroll.
