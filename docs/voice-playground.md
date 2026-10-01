# Voice playground

The dashboard's IVR resources use the same definitions and validation as REST.
The screens are `/playground/ivr`, `/playground/ivr/new`,
`/playground/ivr/[id]`, `/playground/calls`, and `/playground/calls/[id]`.
Menus are ordinary sections with digit/action tables, audio uploads or typed
prompts, invalid/no-input/failure handling, weekly business hours and holidays.
Save replaces the menu array; Validate runs the same backend check used by
`POST /ivrs/{id}/validate`. Number assignments use the existing calling settings
action and warn that assignment replaces the current route.

## Browser test calls

Go online with the existing dashboard softphone, select a connected team number,
and start a test from the saved IVR. The server reserves a call for that authenticated
team, member, browser and ephemeral agent lease. The selected IVR is persisted on
the call; testing does not change the real number's routing. The private HMAC-signed
`POST /playground` gateway operation originates a WebRTC SIP call to the registered
browser extension. No SIP destination is supplied by the browser, and the gateway
requires a live directory session. The browser answers only when Convex has projected
its authorized call. FreeSWITCH then parks and routes the same anchored leg through
`voice-control` and the production IVR runner. It uses the same signed decisions,
HTTP-cache prompts, transfers and duration cap as a customer call. SIP.js `sendDTMF`
uses the session description handler's RFC2833 sender. The keypad is shared with
agent calls.

Calls carry optional `test`, `testUserId` and `testBrowserId` fields. REST reads and
the SDK expose `test`. Test lifecycle, IVR completion and recording/transcription
webhooks are suppressed; no Meta signaling or Meta permission requests occur. There
are no call metrics in this version. Browser ownership persists across transfers;
server admission refuses another call from a tester who already has an active test.
Hangup, setup failure, disconnect and the five-minute FreeSWITCH cap clean up the
call; an independent scheduled cleanup bounds orphaned test records.

The tester reads the reactive REST-shaped call projection for status and the bounded
IVR path. Call rows link to the detail page with its final action, path, events and
recording. A missing calling profile, connected number or trusted WSS configuration
renders a setup EmptyState with the browser-softphone guide. Configured gateways
also receive a health probe and can be checked again after operators start them.
The existing TURN limitations in `docs/browser-softphone.md` apply to these calls.

## Reuse and schema notes

ResourceTable, DetailHeader, DetailSection, MetaStrip, OptionSelect, Field/Input,
Textarea, Button, Badge, Skeleton, EmptyState and TypeToConfirmDialog retain the
existing design and tokens. FileUploadField and AudioPlayer handle prompts. The
existing BrowserPhone and SoftphoneProvider own credentials, media and controls.
The new IVR field groups, editor, routing and tester compose these components because
there was no configurable voice editor or tester. DtmfKeypad extracts the existing
agent keypad for reuse; it adds no design primitive.

Schema additions are optional call fields and an index for active tests by
organization, testing user and status. Finish index backfill before enabling these
queries. No deployment, convex dev, push, other-worktree writes or private website
changes are part of this work.

## Verification

The compiling Playwright IVR flow now creates two menus in the dashboard, validates,
saves, checks readiness and the unconfigured tester, takes a screenshot and deletes.
It is wired through the existing IVR flow in `tests/e2e/auth.spec.ts`. Per the brief,
`pnpm test:e2e` is reserved for integration and is not run here.

The locked `opensend-calling-test` harness includes a SIP.js browser caller test:
HTTP-cache WAV → main `1` → support `2` → voicemail, signed path decisions,
hangup and credential revocation. It also runs the existing IVR, codec, barge-in,
inbound/outbound and browser-agent regressions. Logs are ignored under
`test-results/voice-ui/`. The harness tears down only that Compose project and
releases `/private/tmp/opensend-calling-harness.lock`; named test volumes are retained.

Voice-bot screens, provider credentials and IVR provider TTS rendering await the
integration commit `Merge 8d-2: AI voice bot engine`, as required by the sequencing
instruction. The voice-bot branch has only been read with `git show`.

Phase 1 checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (525),
`pnpm test:auth --maxWorkers=1` (1,116), `pnpm test:sdk` (521 passed,
four existing skips), `pnpm test:mcp` (487 passed, one existing live skip),
`pnpm build`, gateway typecheck/build and 53 gateway tests passed.
The complete locked Docker harness passed, including the new browser playground
path. Playwright flows compile; their execution remains reserved for integration.
