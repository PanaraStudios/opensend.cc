# v2 QA fixes, round 1

Worktree: `qa-fixes`, branch `fix/v2-qa-round1`, based on `origin/v2` at
`0f32d0f`. All twelve requested items are implemented. Nothing was pushed.
Implementation commit: `8e04200` (`fix: resolve v2 QA round 1 failures and dashboard gaps`).
This report is committed separately. Both commits include the requested co-author trailer.

| Item | Change | Regression coverage |
| --- | --- | --- |
| 1. Failed email reason | Terminal send failures retain a friendly explanation and the original provider message. Email detail, message lists and email broadcast recipient outcomes show the explanation; detail and broadcast outcomes offer the provider message. Email GET/list responses and SDK types expose optional `failed.reason` and `failed.provider_message`. Common SES credential, verification/sandbox, throttling/quota, suppression and rejection errors have shared friendly wording. | SES action/storage/dashboard-query/API detail and list tests; broadcast settlement and recipient query tests; shared mapping tests. |
| 2. Send readiness | Disabled sending, DNS verification, domain provisioning, tenant setup/pause, regional setup, callback connection, regional pause and sandbox each identify the domain and the corrective action. REST preserves `403` and `validation_error`. | Extended `convex/emails.test.ts` cause-by-cause assertions, including batch and installation-email regressions; updated SES expectations. |
| 3. Invalid OpenAPI YAML | Expanded every alias and removed every anchor, including repeated names beyond the reported `a1`. Added a repeatable plain-YAML exporter and a strict parser test. The API failure extension and scope order are reflected in the contract. | SDK contract loads YAML using js-yaml with duplicate-anchor rejection, verifies that the rejection works on a duplicate fixture, and checks for remaining anchors/aliases. Backend OpenAPI contracts continue to validate responses. |
| 4. SES layout and double borders | `CardFrame` and the shared `.frame` wrapper now leave the border to their child surface. This applies to settings, Inbox, email previews, contact panels and all shared Surface/PanelTabs users. SES intro sits under the title; AWS/SES sections precede a separate Instance settings section containing storage and telemetry. Routes and docs-link destinations remain available. | Shared DOM surface regression; extended SES browser assertions for intro and section order. |
| 5. Empty segment | Added an Add contacts action with the existing searchable contact picker and membership mutation. Segment tables now query the segment's members. Empty copy explains this picker, contact-detail Add to segment and the Contacts bulk action. | Added browser coverage for an empty segment, searching an existing contact, adding it and seeing membership update. |
| 6. WhatsApp template editor | Added a labeled name field, focus/select on newly created untitled templates, Meta naming guidance and validation before submission. Header breadcrumb is read-only with a distinct accessible label. WhatsApp actions say Submit for review and display the target account, including when only one is connected. Account fallback labels use public names/numbers instead of WABA IDs. | Naming/publish-label unit tests, account-label backend regression, updated browser name/focus/invalid-submit and review-button assertions. |
| 7. API keys | Custom keys require at least one scope in both the dashboard and backend. Inline feedback sits by the scope table. Shared catalog order is Messaging (Email first), Audience, Content & campaigns, Setup, Calling. Creation uses Create API key / Create consistently. | Backend create/update/REST rejection tests, catalog order tests, browser empty-scope assertion and updated creation selectors. |
| 8. Unknown senders | `contactIdentity` defines the channel-specific fallback, such as Messenger user and Instagram user. Message logs delegate to it, matching Inbox. Receiving account handles use the shared formatter so Instagram To and From both include `@`. | Contact/message identity unit tests, Messenger/Instagram log regressions including unknown Receiving identities and Instagram account handle, updated related expectations. |
| 9. Send message defaults | Options follow `CHANNEL_IDS` with Email first. The default prefers the chosen contact's connected channel, otherwise the team's first available sending channel. Disconnected/unregistered senders are excluded. With none available, the form explains what to connect and cannot submit. | Default-selection unit tests, team-scoped connected-sender backend tests and browser Email-first assertion. |
| 10. Invite-only sign-up | Verified the HTTP flow: the atomic user-create admission trigger was hidden behind BetterAuth's generic error. A server preflight now returns the explicit invite-only explanation with HTTP 422, while atomic admission remains enforced. The existing signup UI displays that server message. | HTTP regression asserts the exact explanation and that no rejected user is inserted; browser signup assertion uses the exact message. |
| 11. Unexplained states | Inbox distinguishes disconnected, connected-empty and filtered-empty states. Calls explains missing gateway/browser connection and TURN, with setup docs; softphone availability also requires configured calling. IVR creation explains provider/key/voice requirements while preserving audio-only drafts. Channel Calling settings explains gateway/TURN and links to the same docs. | Inbox copy tests, IVR browser requirement assertion, calling browser setup/help/docs assertions, existing calling backend coverage. |
| 12. Fractional timestamps | Sent email adapters round Convex creation timestamps to integer milliseconds, including the detail payload. | Test uses the reported fractional timestamp against the actual adapter and serialized payload. |

## Conservative decisions and limits

- Storage and telemetry remain on `/instance/ses` in a clearly labeled instance-level section. This avoids breaking existing installation links and selectors while putting SES first.
- `failed` on email retrieval is an additive Opensend extension using the existing Resend-shaped `email.failed` webhook's `reason` field. Existing response fields, status codes and error names are preserved.
- Email and local Messenger/Instagram templates keep Publish because those local templates do not undergo Meta review. WhatsApp templates use Submit for review.
- IVRs may still be created as audio-only drafts. Selecting a prompt provider requires its key and voice before creation; the UI explains both paths.
- Previously sanitized provider messages cannot be reconstructed. New terminal send failures retain the original message, limited to 4,000 characters; existing saved reasons still receive friendly rendering.
- The browser tests were extended but not executed: this worktree has no configured fresh QA stack/deployment. Live SES/Meta checks were not run; provider failures and API flows are exercised with the existing test fixtures. No deployment or `convex dev` was run.
- Schema changes only add optional diagnostic fields and indexes. Package scripts are unchanged; the only new package dependencies support strict YAML contract testing.

## Checks

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, no warnings |
| `pnpm test` | Passed: 737 tests |
| `pnpm test:auth --maxWorkers=2` | Passed: 1,403 tests across 97 files |
| `pnpm test:sdk` | Passed: 683 tests; 4 existing live-test skips |
| `pnpm test:mcp` | Passed: 666 tests; 1 existing live-test skip |

Focused email regressions also passed after the final provider-mapping refinement.
Email broadcast recipients use the shared email status badge, including suppression
and cancellation; the recipient page hydrates email statuses with bounded,
deduplicated reads.

The final isolated broadcast and read-cost rerun passed all 32 tests. An earlier
extra concurrent run hit the existing large-audience test's 30-second timeout;
that test passed in the full requested suite and in the isolated rerun without
changing its timeout.

## Follow-up: channel select after asynchronous sender loading

Browser QA on `cda7ff9` found a blank Channel select in Send message. The
default was already recomputed on every render; the shared `OptionSelect`
passed `undefined` initially, which made Base UI fix the select as uncontrolled.
It then ignored the controlled Email value when senders arrived. A DOM regression
reproduced the blank value and Base UI's controlled/uncontrolled warning before
the fix.

- `OptionSelect` now treats an explicitly provided empty value as controlled
  from the first render, using Base UI's `null` empty value. Omitting `value`
  still supports uncontrolled `defaultValue` usage. `SearchableSelect` follows
  the same distinction and no longer restores an old internal choice when its
  controlled value is cleared.
- Send message distinguishes a loading sender query from a loaded empty list.
  Loading shows a disabled Loading channels select; the connect-channel
  explanation appears only after a loaded query returns no sending channels.
  The loaded default prefers the contact's connected channel, otherwise the
  first available channel in `CHANNEL_IDS` order. A valid manual choice wins
  and remains visible during reloads. A genuinely removed sender falls back
  to an available channel. Submission waits for availability to load.
- Reviewed the other changed forms: API key creation uses static permission
  and all-domain defaults; editing receives an already loaded key. The segment
  picker waits for a user selection and retains its selected label. WhatsApp
  editors mount after the template loads, and WABA selection is assigned on
  the backend. IVR provider/language defaults are static, with ElevenLabs voice
  adoption explicitly waiting for its catalog. SES and Calling edits use loaded
  records; the playground tester derives its account fallback from current
  setup data. No additional one-time defaults from unloaded queries were found.
- New helper and DOM tests cover loading → loaded, contact preference, manual
  dropdown selection → loading → loaded, actual empty results, clearing a
  controlled value, and uncontrolled default/selection behavior. Both ordinary
  and searchable select variants are exercised. The existing Messages browser
  assertion remains unchanged.

Validation:

| Command | Follow-up result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed, no warnings |
| `pnpm test` | Passed: 740 tests |
| `pnpm exec tsx --test lib/dashboard/send-channels.test.ts lib/dashboard/field-accessibility.test.ts` | Passed: 26 tests |
| `pnpm exec vitest run --config vitest.auth.config.ts convex/conversations.test.ts --maxWorkers=2` | Passed: 21 tests |

Browser E2E could not run locally: Docker cannot connect to the configured
Colima socket because its daemon is unavailable. Nothing was pushed.
