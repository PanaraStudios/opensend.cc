# Voice playground

The dashboard uses the same resource definitions, provider credentials, validators
and number routing as REST. Setup and test screens are:

- `/playground/ivr`, `/playground/ivr/new`, `/playground/ivr/[id]`
- `/playground/voice-bot`, `/playground/voice-bot/new`, `/playground/voice-bot/[id]`
- `/playground/calls`, `/playground/calls/[id]`

IVRs use sections and digit/action tables, uploaded audio or typed prompts,
invalid/no-input/failure handling, weekly business hours and holidays. Save replaces
the menu array; Validate uses the backend check behind `POST /ivrs/{id}/validate`.
Explicit PATCH null clears `promptVoice` or `businessHours`. Number assignment uses
the existing calling settings action, warns about replacing IVR/bot/agents routing,
and restores agents on unassignment.

Voice bots expose Gemini Live and cascade stage/provider/model/key choices from the
shared validation catalog, system prompt, greeting, disclosure, tools, agent/IVR
handoffs, recording and safety/budget limits. Provider keys are a plain section on
the Voice bot tab because this dashboard has no Integrations settings page. Keys
are encrypted and write-only, shown only by label/provider/last four. Delete uses
TypeToConfirmDialog; referenced keys cannot be deleted.

## IVR prompt rendering

Choose `promptVoice: {provider, voice, language, credentialId}` using a team
ElevenLabs or Sarvam credential. Typed prompts are rendered asynchronously on save
in batches of at most four, with three bounded HTTP attempts and backoff for failures.
A transaction claims each hash with a lease to avoid duplicate concurrent renders.
Cache keys include text, effective language/voice, provider/model/format and team
scope. Identical content in another team never reuses its audio.

The [ElevenLabs REST contract](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
uses `output_format=pcm_16000`; the renderer wraps signed 16-bit mono PCM in WAV.
The [Sarvam REST contract](https://docs.sarvam.ai/api-reference/text-to-speech/convert)
uses explicit `bulbul:v3`, `language_code`, `speaker`, `speech_sample_rate: 16000`
and `output_audio_codec: wav`. Its single base64 audio is bounded and checked for
16 kHz mono PCM WAV. Audio is stored through the existing storeFile helper and
played by FreeSWITCH via the existing signed HTTP-cache prompt path.

`prompt_renders` exposes status, a safe error and a preview URL for every prompt;
`prompt_status` summarizes ready/pending/failed. AudioPlayer previews uploads and
rendered speech. `POST /ivrs/{id}/render`, `opensend.ivrs.render` and MCP `render-ivr`
retry failed/expired renders and reuse ready cached audio. Legacy typed definitions
without promptVoice remain pending; re-render requires a configured team key.

## Browser test calls

Go online with the existing dashboard softphone, select a connected team number
and optional test contact, then start a saved IVR or bot. The server reserves a call
for the authenticated team, member, browser and ephemeral agent lease. Its selected
IVR/bot is persisted independently of live number routing. The private HMAC-signed
`POST /playground` operation originates a WebRTC SIP call to the registered browser
extension. The browser answers only its Convex-authorized call. FreeSWITCH parks
and routes the same anchored leg through voice-control and the production IVR/bot
runner. Bot media uses gateway Path B and Pipecat; IVR handoffs continue on that leg.
No SIP destination is supplied by the browser. SIP.js sendDTMF uses the session
handler's RFC2833 sender; the keypad is shared with agent calls.

Calls carry optional test/testUserId/testBrowserId fields. REST/SDK reads expose
`test` and the bot's snapshot name. A test rings until signed media confirmation;
an unanswered setup cannot be displayed as connected. Test lifecycle, IVR/bot
completion/transfer and recording/transcription webhooks are suppressed. Tests do
not perform Meta signaling/permission requests or enter production minute/concurrency
accounting. WhatsApp send tools return an explicit test preview; no customer message
is sent. IVR decision webhooks follow the configured branch through the same path
and include `call.test: true` for integrators. Provider usage still consumes the team's provider credits.

Browser ownership persists across transfers. Server admission refuses a second
active call for a tester, and handoff cannot select the testing caller as the agent.
Hangup, setup failure, disconnect, the five-minute FreeSWITCH cap and an independent
scheduled cleanup bound orphan calls. Credentials remain only in gateway/browser
memory; no static password or directory fallback is added.

The reactive tester shows IVR path, caller/bot turns, interrupted turns, tool
arguments/results, end-of-speech-to-first-audio latency, provider usage, outcome and
summary. Dollar costs are not reported by the engine; the meter shows tokens, audio
seconds and TTS characters. Transcripts are paginated. The panel continues when an
IVR hands off to a bot. Calls rows show path, snapshot bot name/outcome and transfer
target and link to detail with diagnostics, events and recording.

Missing calling profile, number, trusted WSS or healthy gateway renders a setup
EmptyState with documentation and a connection recheck. The TURN configuration
requirements in browser-softphone.md apply to these calls.

## Reuse and schema

ResourceTable, DetailHeader, DetailSection, MetaStrip, OptionSelect, Field/Input,
Textarea, Switch, Checkbox, Button, Badge, Skeleton, EmptyState and TypeToConfirmDialog
retain the existing design and tokens. FileUploadField and AudioPlayer handle
prompts. BrowserPhone/SoftphoneProvider own credentials, media and controls.
New editor/field groups, routing, provider-key and diagnostic components compose
these because there was no configurable voice editor or tester. DtmfKeypad extracts
the agent keypad for reuse; no new design primitive, token or icon package is added.

Schema additions are optional IVR promptVoice, prompt render status/error/lease
fields, optional test call metadata and indexes for active tests, production bot
admission and credential references. Finish index backfill before enabling these
queries. Legacy definitions require no backfill. The integration branch was merged
only after `Merge 8d-2: AI voice bot engine` appeared. No deployment, convex dev,
push, other-worktree writes or private website changes were performed.

## Verification

Playwright flows compile and cover IVR two-menu create/validate/readiness/delete,
bot create/edit/delete, provider-key masking/deletion and unconfigured testers.
Routing assignment/unassignment is exercised when gateway configuration is available;
the unconfigured stack asserts its disabled assignment. Screenshots are wired into
the existing IVR and voice-bot flows in auth.spec.ts. Per the brief, test:e2e is not run.

The locked opensend-calling-test harness proves both browser caller paths, real
HTTP-cache WAV playback, RFC2833 main 1 → support 2 → voicemail, signed Pipecat
sessions/events/completion, credential revocation, both RTP codecs, barge-in and
caps, inbound/outbound calling, IVR → bot → agent and bot → IVR → agent. Only that
Compose project is torn down; named test volumes are retained and the shared lock
is released. Logs are ignored under `test-results/voice-ui/`.

Live paid-provider smoke is not run: provider HTTP is mocked in renderer tests and
Pipecat uses the deterministic fake pipeline in the isolated media harness.

Final checks (2026-10-02):

| Check                         | Result                                               |
| ----------------------------- | ---------------------------------------------------- |
| pnpm typecheck                | PASS, including the Playwright flows                 |
| pnpm lint                     | PASS, no errors or warnings                          |
| pnpm test                     | PASS, 533 tests                                      |
| pnpm test:auth --maxWorkers=1 | PASS, 1,133 tests                                    |
| pnpm test:sdk                 | PASS, 522 tests; four existing live skips            |
| pnpm test:mcp                 | PASS, 494 tests; one existing live skip              |
| pnpm build                    | PASS                                                 |
| Gateway typecheck/build/tests | PASS, 55 tests                                       |
| Locked calling harness        | PASS, both playground paths and all regression modes |

SKIPPED: running test:e2e, as required by the lane brief; live paid-provider smoke,
which needs real provider keys. No push or deployment was performed.
