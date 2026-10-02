# Playground redesign handoff

Completed on `feat/v2-voice-ui` within the revised 60-minute timebox. No push, no Convex dev, no deployment. The revised instruction leaves the full e2e suite to the lead.

## Screens

- **DONE — Voice bots:** `/playground/voice-bot` has search, a responsive table and a Create dialog. `/playground/voice-bot/[id]` has the conversation stage, disabled Start test call with setup guidance, microphone/contact selectors, a fixed settings rail, Instructions, readable Voice & language, Models, tool switches, confirmed phone-routing replacement, collapsed Advanced limits, rename/duplicate/copy/delete, and the mobile Settings sheet.
- **DONE — IVR:** `/playground/ivr` has search, a responsive table and a Create dialog. `/playground/ivr/[id]` has incoming-call/menu/destination workflow cards, keypad branches, nested submenus, a selected-card editor, readable prompt statuses, validation results linked to the relevant menu, language choices, business-hours settings, and a Test IVR sheet with a large keypad. New menu IDs derive from names; saved menu IDs remain stable. No menu ID input.
- **DONE — AI providers:** `/settings/ai-providers` follows the Settings tab pattern. Masked keys, provider icons, labels, added dates, row menus and confirmed deletion. The same Add dialog opens from model and prompt-key selectors.
- **DONE — Shared controls:** selected outline toggles use inverted fill; radio cards have a clear selected border/fill. Secret inputs carry new-password autocomplete, a non-credential default name and 1Password/LastPass/Bitwarden ignore attributes. Existing service-specific FormData names and account-login autofill are preserved. Chromium opened the new provider-key dialog with an empty secret field; no installed password-manager extension or preloaded credential profile was available for testing.
- **DONE — Calling scope group and titles:** Calling, IVRs, Voice bots and Voice providers appear together, in that order. List/settings/call pages have metadata in the opensend.cc pattern; authenticated bot/IVR pages update the title to the resource name. Existing WhatsApp grants continue to authorize calls, and existing Voice bots grants continue to authorize provider keys. The new narrower grants do not grant WhatsApp messaging or bot administration respectively.
- **DONE — Calls and softphone:** `/playground/calls` separates contact, direction, route, outcome, duration and start time. `/playground/calls/[id]` uses DetailHeader, MetaStrip, shared IVR breadcrumbs/transcript bubbles/tool details, and AudioPlayer. The sidebar softphone appears for a gateway-mode number (or an active call); its panel provides Online/Away, microphone selection and View calls. Start test call can register the browser before starting the existing real-call path.
- **SKIPPED — Floating call card:** deliberately deferred under the revised priorities.
- **SKIPPED — Live gateway/provider verification:** no gateway runs in the retained throwaway preview backend. Actual idle-ready and mid-call screenshots, live audio, voice-sample previews, and provider-account-specific voice discovery remain for the integration/live-calling review. Built-in readable voice choices are present.

## IVR tester root cause: proved

The previous failed run's accessibility snapshot already contains:

`Calling stack is not configured Connect a WhatsApp number, enable the calling profile ...`

It appears as plain text, while the failing assertion was `getByRole("heading", { name: "Calling stack is not configured" })`. `components/ui/empty.tsx` rendered EmptyTitle as a div. The state was rendered; its title lacked heading semantics.

Evidence:

- `test-results/opensend-e2e-1790952405583-67b09b/html/data/849451037db26473b2d37c949b1e80a64633bfd2.md` contains both the failed heading assertion and the visible state text.
- That run's `auth-function-logs.jsonl` has successful `calling/playgroundState:setup` and contacts queries, and no `calling/playground:health` invocation. This excludes a stalled health probe as the cause of that failure.
- `scripts/test-e2e.mjs` generates a fresh environment without CALL_GATEWAY_URL, CALL_GATEWAY_SECRET or CALL_AGENT_WSS_URL, and starts only the standard services plus `oidc-test`. The calling services in `compose.yaml` require the separate `calling` profile.
- `convex/calling/playgroundState.ts` returns configured=false without those variables. The tester displays unavailable immediately and runs the health action only when configured=true. The gateway client already bounds `/healthz` to two seconds; its 30-second timeout is for POST control requests, which are not on this path.
- Before the revised no-e2e instruction, a fresh focused bootstrap + IVR reproduction passed (2/2) on the partial commit's added heading role, using the throwaway project `opensend-e2e-1790954378689-33c8b0`. This confirms the semantic diagnosis. It is not a validation run of the final redesigned e2e flows.

The fix is at the shared EmptyTitle root: it now renders a native h3. A regression test checks its semantics without caller-supplied role attributes. The existing checking state, guarded health action and bounded probe remain. The updated e2e flow also checks configured=false, the heading, disabled Start and disabled keypad.

## Validation

| Check                                       | Result                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                              | PASS; already up to date                                                                                                                    |
| `pnpm typecheck`                            | PASS                                                                                                                                        |
| `pnpm lint`                                 | PASS; no errors or warnings                                                                                                                 |
| `pnpm test`                                 | PASS; 540 tests                                                                                                                             |
| `pnpm build`                                | PASS                                                                                                                                        |
| Focused Convex playground tests, one worker | PASS; 6 tests, including timeout, isolation, gateway-mode setup and last test                                                               |
| Chromium review                             | PASS; provider and bot dialogs, bot settings sheet, two-menu IVR flow, destination editor, validation, tester sheet, both themes and widths |
| Scope selected-state browser check          | PASS; selected fill is opaque and differs from text in both themes                                                                          |
| Updated e2e selectors                       | Typechecked; use roles and visible labels                                                                                                   |
| Full `pnpm test:e2e`                        | SKIPPED after the revised instruction; lead runs it                                                                                         |
| Full auth/SDK/MCP suites                    | SKIPPED under the revised four-check timebox; focused Convex coverage ran                                                                   |

The browser review used the current Next.js UI against the already-created throwaway backend; backend additions were verified by Convex tests and compilation, not deployed. Only the two throwaway e2e projects created during the initial investigation were used and cleaned up. No `opensend` project or `opensend_*` resource was touched; no prune.

## Components and backend notes

Reused ResourceTable, DetailHeader, MetaStrip, EmptyState, ToneBadge, OptionSelect, RadioCards, TypeToConfirmDialog, ConfirmDialog, MoreMenu, Field, Input, Textarea, Switch, Checkbox, SegmentedToggle, Dialog, Sheet, AudioPlayer, the shared DTMF keypad and automation WorkflowCard. The local rail and recursive IVR rendering functions compose these primitives; no icon package or design tokens were added.

Testing still uses the SIP.js browser leg → FreeSWITCH → existing playground actions → gateway IVR/bot route, with test-call records and reactive transcript/usage queries. There is no simulated production call path.

One index was added: `calls.by_organizationId_and_botId_and_test`, used for a bounded per-bot last-test lookup. Number setup now includes the saved handling mode. No data backfill or secret migration is required. The lead must apply the normal backend build/deployment workflow before using these additions; this lane did not deploy.

## Screenshots

58 screenshots are available in `test-results/voice-redesign-review/`. Dialog animations were disabled for the refreshed captures. Live idle/mid-call and call-detail state captures are deferred as stated above. Paths:

- `test-results/voice-redesign-review/bot-create-dark-1440.png`
- `test-results/voice-redesign-review/bot-create-dark-390.png`
- `test-results/voice-redesign-review/bot-create-light-1440.png`
- `test-results/voice-redesign-review/bot-create-light-390.png`
- `test-results/voice-redesign-review/bot-list-empty-dark-1440.png`
- `test-results/voice-redesign-review/bot-list-empty-dark-390.png`
- `test-results/voice-redesign-review/bot-list-empty-light-1440.png`
- `test-results/voice-redesign-review/bot-list-empty-light-390.png`
- `test-results/voice-redesign-review/bot-list-filled-dark-1440.png`
- `test-results/voice-redesign-review/bot-list-filled-dark-390.png`
- `test-results/voice-redesign-review/bot-list-filled-light-1440.png`
- `test-results/voice-redesign-review/bot-list-filled-light-390.png`
- `test-results/voice-redesign-review/bot-not-configured-dark-1440.png`
- `test-results/voice-redesign-review/bot-not-configured-dark-390.png`
- `test-results/voice-redesign-review/bot-not-configured-light-1440.png`
- `test-results/voice-redesign-review/bot-not-configured-light-390.png`
- `test-results/voice-redesign-review/bot-settings-dark-390.png`
- `test-results/voice-redesign-review/bot-settings-light-390.png`
- `test-results/voice-redesign-review/ivr-create-dark-1440.png`
- `test-results/voice-redesign-review/ivr-create-dark-390.png`
- `test-results/voice-redesign-review/ivr-create-light-1440.png`
- `test-results/voice-redesign-review/ivr-create-light-390.png`
- `test-results/voice-redesign-review/ivr-flow-destination-selected-dark-1440.png`
- `test-results/voice-redesign-review/ivr-flow-destination-selected-dark-390.png`
- `test-results/voice-redesign-review/ivr-flow-destination-selected-light-1440.png`
- `test-results/voice-redesign-review/ivr-flow-destination-selected-light-390.png`
- `test-results/voice-redesign-review/ivr-flow-menu-selected-dark-1440.png`
- `test-results/voice-redesign-review/ivr-flow-menu-selected-dark-390.png`
- `test-results/voice-redesign-review/ivr-flow-menu-selected-light-1440.png`
- `test-results/voice-redesign-review/ivr-flow-menu-selected-light-390.png`
- `test-results/voice-redesign-review/ivr-list-empty-dark-1440.png`
- `test-results/voice-redesign-review/ivr-list-empty-dark-390.png`
- `test-results/voice-redesign-review/ivr-list-empty-light-1440.png`
- `test-results/voice-redesign-review/ivr-list-empty-light-390.png`
- `test-results/voice-redesign-review/ivr-list-filled-dark-1440.png`
- `test-results/voice-redesign-review/ivr-list-filled-dark-390.png`
- `test-results/voice-redesign-review/ivr-list-filled-light-1440.png`
- `test-results/voice-redesign-review/ivr-list-filled-light-390.png`
- `test-results/voice-redesign-review/ivr-tester-dark-1440.png`
- `test-results/voice-redesign-review/ivr-tester-dark-390.png`
- `test-results/voice-redesign-review/ivr-tester-light-1440.png`
- `test-results/voice-redesign-review/ivr-tester-light-390.png`
- `test-results/voice-redesign-review/providers-create-dark-1440.png`
- `test-results/voice-redesign-review/providers-create-dark-390.png`
- `test-results/voice-redesign-review/providers-create-light-1440.png`
- `test-results/voice-redesign-review/providers-create-light-390.png`
- `test-results/voice-redesign-review/providers-empty-dark-1440.png`
- `test-results/voice-redesign-review/providers-empty-dark-390.png`
- `test-results/voice-redesign-review/providers-empty-light-1440.png`
- `test-results/voice-redesign-review/providers-empty-light-390.png`
- `test-results/voice-redesign-review/providers-filled-dark-1440.png`
- `test-results/voice-redesign-review/providers-filled-dark-390.png`
- `test-results/voice-redesign-review/providers-filled-light-1440.png`
- `test-results/voice-redesign-review/providers-filled-light-390.png`
- `test-results/voice-redesign-review/scopes-dark-1440.png`
- `test-results/voice-redesign-review/scopes-dark-390.png`
- `test-results/voice-redesign-review/scopes-light-1440.png`
- `test-results/voice-redesign-review/scopes-light-390.png`
