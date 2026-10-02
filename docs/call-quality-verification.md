# Calling quality and hangup verification — 2026-10-03

Worktree: `fix/v2-call-quality`. Merged `origin/v2` at `8724353`, retaining
BSUID identity resolution (#15) and `rtp-rewrite-timestamps=true` (#16).

## Findings and fixes

**Hangup was slow, and default instructions did not explain when to use it.**
In `origin/v2`, `defaultVoiceBotSystemPrompt` only appended safety and language
instructions. The gateway's successful `end_call` branch then waited a fixed
3,000 ms. `CallController.finish` killed the FreeSWITCH channel but awaited
`VoiceRuntime.stop` (including bot summarization) before notifying Convex and
closing Janus. The complete teardown path already existed; these waits delayed
the WhatsApp leg. Live tool wiring was verified and was not the cause.

- [Default prompt builder](../lib/voice-bot-defaults.ts) and
  [runtime prompt assembly](../services/voice-agent/voice_agent/factory.py)
  now explain goodbye, explicit hangup requests and completed conversations.
  Saved custom prompts remain intact; runtime end-call guidance requires the
  enabled tool.
- [Pipecat playback observer](../services/voice-agent/voice_agent/playback.py)
  reports output completion. The [gateway playback queue](../services/call-gateway/src/audio.ts)
  pads the final partial packet and drains before hangup. The
  [runtime](../services/call-gateway/src/voice-runtime.ts) waits another 100 ms
  for the final RTP packet, bounded by a 2.5-second fallback after tool success.
  New audio, interruption and caller activity invalidate prior completion.
- [Controller teardown](../services/call-gateway/src/controller.ts) sends its
  hangup callback and closes Janus without waiting for summarization. The
  signed Convex callback still schedules
  [gatewayHangup → Meta terminate](../convex/calling/callActions.ts).

**Tool execution was hard to diagnose.** Python and the gateway now log tool
names, requested/succeeded/failed status and elapsed milliseconds. Backend
validation errors previously became generic failures; bounded errors now reach
the bot, gateway observations and call detail. Arguments, results and provider
keys are excluded from these service logs. Gateway `hangup` events carry the
reason; call detail renders tool and hangup diagnostics in the transcript.
The full harness also reproduced outbound ESL closure winning a race against
FreeSWITCH's `ALLOTTED_TIMEOUT` event. Socket-close/error fallbacks now use the
same 100 ms grace as bridge completion, allowing the actual channel cause to
arrive before assigning a generic disconnect reason.
See [tool router](../services/voice-agent/voice_agent/tools.py),
[adapter](../services/call-gateway/src/voice/pipecat.ts) and
[call diagnostics](../components/dashboard/playground/bot-diagnostics.tsx).

**Prompt processing did not enforce a shared storage quality policy.** Uploaded
WAV/MP3/OGG and rendered TTS now pass through the signed gateway converter before
storage: mono 16 kHz PCM16 WAV, filtered resampling, approximately −18 LUFS and a
−2 dBTP ceiling. Conversion runs at upload/render completion, not per playback.
ElevenLabs requests native 44.1 kHz PCM, with 24 kHz PCM fallback for lower-tier
credentials; Sarvam requests 24 kHz PCM WAV. Renderer version keys prevent reuse
of older generated assets. Existing prompts need re-rendering or re-uploading.
See [converter](../services/call-gateway/src/prompt-audio.ts),
[renderers](../lib/ivr-renderers.ts),
[upload completion](../convex/storage/objects.ts) and
[render storage](../convex/ivr/rendering.ts).

**The Docker harness exposed an additional Opus bandwidth policy.** With Meta's
16 kHz / 20 kbps fmtp, FreeSWITCH reported 16 kHz read/write rates, and the stored
WAV retained both 440 Hz and 6 kHz tones. Received Opus packets nevertheless used
medium-band configuration 5 and lost the 6 kHz tone. The
[pinned FreeSWITCH implementation](https://github.com/signalwire/freeswitch/blob/ef32e205295e29f034f1453ad245ba5efb07b94a/src/mod/codecs/mod_opus/mod_opus.c)
defaults to forced FEC and a 20% codec loss estimate; its forced-FEC table
overrides the negotiated bitrate with 17.6 kbps at 16 kHz. A local libopus
reproduction at that rate selected narrow/medium-band encoding.

[Opus configuration](../docker/freeswitch/conf/freeswitch.xml.template) now
negotiates the lower remote bitrate, explicitly caps playback at 16 kHz and
disables the forced-FEC bitrate override. Opus can still select in-band FEC
within the negotiated rate. The received packets use wideband configuration 9
and retain the 6 kHz tone. No RTP or jitter settings were changed, including the
existing codec loss estimate. #16's timestamp rewrite remains in place; the
already-fixed live voice distortion was not attributed to prompt storage.

**Bot output retains 16 kHz throughout its media leg.** Pipecat's output
transport resamples Gemini native output to mono PCM16/16k; cascade TTS requests
16k directly. The gateway uses L16/16k for production bot routes. PCMU/8k remains
an explicit compatibility harness case, rather than a silent production fallback.

**Voice gender and caller context lacked useful metadata.** The shared
[voice catalog](../services/call-gateway/src/voice/voices.ts) includes genders
with official provider references. Language, voice and provider changes replace
only exact built-in greetings/disclosures; edited text is preserved. Runtime
instructions specify first-person grammatical gender, without assigning a
gender to unknown custom voice IDs.

[lookup_contact](../convex/voice/gateway.ts) resolves the current caller through
the v2 phone/BSUID identity resolver and returns phone, email, custom properties,
tags (contact segment names) and channel identities. Recent messages use the
shared message preview and template renderer, including interactive body/reply
text, rendered template text and media type/caption. Each entry includes
customer/business direction and relative time. Tool schema descriptions and
documentation describe these fields.

## Reproduction and checks

The Docker harness uses only project `opensend-calling-test` under
`/private/tmp/opensend-calling-harness.lock`. Host port mappings are disabled in
the harness overlay to avoid conflicts and reduce Colima resource use. No live
project, live volume or prune operation was used.

[meta-peer.ts](../services/call-gateway/scripts/meta-peer.ts) receives actual
Opus through FreeSWITCH → Janus. The IVR test normalizes a 48k source containing
440 Hz and 6 kHz, verifies a 16k WAV, inspects the channel's Opus/16k rate, and
checks the decoded Meta recording retains the high tone. This catches an 8k
audio path rather than merely checking the WAV header.

The end-call test plays a 600 ms goodbye through the real Pipecat output
transport before invoking the fake backend tool. It requires audible goodbye
at Meta, a playback-done event before hangup, hangup within one second of
completion/tool success, and less than 2.5 seconds from tool success. It also
requires `uuid_exists=false`, removal of the Janus handle, finalized recording,
`ended_by_bot`, the hangup reason, and a separate fake Meta endpoint receiving
`terminate`. The Docker callback substitutes for Convex; the
[signed Convex test](../convex/voice.test.ts) separately runs the actual callback,
scheduler and `gatewayHangup` against fake Graph. No live provider inference or
live Meta calls are used by these tests.

Final full harness results: all ten modes passed (`playground`, `playground-bot`,
`baseline`, `agent`, `voice`, `bot-engine`, `bot-end-call`, `ivr-engine`,
`ivr-bot-agent`, `bot-ivr`). End-call L16/PCMU hangup arrived **105 ms after
playback completion**, and **757/758 ms after tool success**. The IVR Meta
recording measured 6 kHz tone power **1192** versus 440 Hz **1055**, with Opus
wideband configuration **9** and FreeSWITCH read/write rates **16000**.
Both combined transfer directions preserved the anchored call and agent audio.
The harness removed its containers/network and released the lock successfully.

| Check                                        | Result                                        |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm typecheck`                             | Passed                                        |
| `pnpm lint`                                  | Passed                                        |
| `pnpm test`                                  | 580 passed                                    |
| `pnpm test:auth --maxWorkers=2`              | 74 files, 1,154 tests passed                  |
| `pnpm --dir services/call-gateway typecheck` | Passed                                        |
| `pnpm --dir services/call-gateway test`      | 61 passed                                     |
| `pnpm test:voice-agent`                      | 26 passed; nine upstream deprecation warnings |
| Python Ruff                                  | Passed                                        |
| `pnpm test:calling-harness`                  | All ten modes passed                          |
| `pnpm build`                                 | Passed                                        |

Local verification logs are retained in the ignored `test-results/call-quality/`
directory. Gateway tests used a local ffmpeg binary on this Mac; the gateway
Docker image installs ffmpeg. Voice-agent checks used the frozen Python lockfile.
No push, Convex development process or backend deployment was performed.
