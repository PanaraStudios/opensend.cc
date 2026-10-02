# WhatsApp calling core (8a)

Convex owns Graph signaling and the `calls` webhook projection. Calls have a stable
Opensend `id`; Meta's `wacid` is separate and appears in call reads. Identities and
permission caches use the user's BSUID. Supply `recipient`, or a `to` phone whose
BSUID has already been learned for this business. Phone numbers are optional in
inbound calling webhooks.

Set `CALL_GATEWAY_URL` and `CALL_GATEWAY_SECRET` on the Convex backend to use the
[merged gateway contract](calling-gateway.md). Gateway mode is the per-number
default when both are configured; otherwise the default is API mode. Every call
snapshots its mode, so changing number settings affects subsequent calls.

The signed callback receiver is `POST /calling/gateway/events`. It verifies the
exact raw body with Web Crypto, persists nonce replay protection, and deduplicates
`eventId`. Equal retries with fresh nonces return 200. SDP-ready and media-up events
never accept calls or release RTP. Terminal calls remain terminal even when callbacks
or Meta events arrive late. Nonces expire through scheduled cleanup.

In gateway mode, an inbound offer prepares Janus and sends Graph `pre_accept`.
The REST/SDK integrator then calls `accept`; only after Graph succeeds does Convex
route media to 8b's demo IVR. Outbound calls use `outbound → Graph connect → remoteAnswer
→ route`. The demo IVR is the only automatic route in 8a. Agent claiming, browser
credentials and softphone UI belong to 8c; configurable IVRs, queues and bots belong
to 8d. API mode forwards remote SDP in customer webhooks and call reads, and accepts
the integrator's complete answer. Integrators must meet Meta's ICE-full controlling,
DTLS client/ECDSA, complete SDP, Opus/20ms, single-track, single-SSRC and media-first
requirements. No trickle ICE, renegotiation, ICE restart or PSTN legs are supported.

REST resources use the `whatsapp:read` / `whatsapp:write` scopes:

- `GET /whatsapp/calls` (limit/after/before; optional `phone_number_id`) and `GET /whatsapp/calls/{id}`.
- `POST /whatsapp/calls`, with `recipient` and either `route: "gateway"` or `session: {sdp_type: "offer", sdp}`. Supplying an SDP selects API mode unless route is explicit.
- `POST /whatsapp/calls/{id}/pre_accept|accept|reject|terminate`.
- `GET|POST /whatsapp/phone-numbers/{id}/calling`, with `calling` and/or `handling_mode`. Phone-number IDs or connected account IDs are accepted.
- `GET /whatsapp/call-permissions?recipient=...&from=...` (or `to=` for a known phone).
- `POST /whatsapp/call-permissions`, with a free-form `text` or an approved call-permission `template`; the existing message pipeline enforces the service window.

POSTs support `Idempotency-Key`. Connect commits its call ID with the reservation
before external setup; a retry cannot create another call, including after a lost
Graph response. If signaling fails, inspect the returned/replayed call ID for its
failure state before deciding to start a new call with a new key. Meta owns
permission/request limits; the permission response exposes its actions and limits.

`call_hours` writes replace the whole schedule; omitting holidays removes them.
Settings writes omit unconfigured optional blocks and empty arrays. Existing SIP
or SDES configuration is reset to SIP-off/DTLS only when cached settings show it
is configured; a simple enable sends status and call icon visibility. An `announcement_file_id`
from the existing finalized team-file upload flow uploads an Ogg Opus announcement
under 60 seconds using `use_case=call_voicemail_announcement`. Read settings may
include Meta's restrictions; calling changes also refresh through
`account_settings_update`, and account restrictions are cached from `account_update`.
After upgrading an existing installation, re-run the instance Meta webhook subscription
operation to add `calls` and `account_settings_update` (the subscription already
includes `account_update`). No automated deployment or subscription changes are made.

Customer events are `whatsapp.call.ringing|connected|completed|failed|missed`,
`permission_updated`, `recording_ready`, and `transcription_ready`. Calls use the
REST read shape; API-mode events include SDP. A later SDP or duration observation
can emit the same state with enriched data. Event timestamps and the call's
`observed_at` are milliseconds; delivery order is not guaranteed.

Meta recordings/transcripts refresh the five-minute media URL, verify the supplied
SHA-256, and are stored through `convex/storage/objects.storeFile` in Convex storage. Failed downloads retry and surface a media error.
Download links are generated from storage references on reads. Gateway callbacks
carry a finalized local path, not an HTTP download URL. For gateway recordings,
mount the recordings volume **read-only into the Convex Node action environment**
and set `CALL_GATEWAY_RECORDINGS_DIR` to that mount. Only a UUID `.wav` resolved
inside that root is read. Missing mounts produce an explicit recording error; after
configuration, re-run `calling/media:gatewayRecording` with the call ID. Docker
configuration is intentionally unchanged in 8a. Hosted Convex without this mount
needs a separate volume-side uploader; the current 8b API has no file-download endpoint.

Schema changes are new tables/indexes only: `calls`, `callEvents`, `callPermissions`,
`callingSettings`, `gatewayEvents`, `gatewayNonces`. Existing documents need no
migration. Team retirement erases the new scoped records and stored call media.
The dashboard changes are limited to the WhatsApp channel detail's calling settings
and paginated call log.

The fake-Graph Playwright flow is wired into `tests/e2e/auth.spec.ts` and writes
`calling-settings.png` / `calling-log.png`. Run it through the lead's integration
harness. Real media interoperability remains 8b's Janus/FreeSWITCH harness, followed
by UIC testing on the live number; that US number cannot validate BIC.

Wave 8c now supplies [browser agents](browser-softphone.md): accepted calls claimed
by an agent route to that agent's session extension. Unclaimed API/integrator calls
retain the demo IVR route. Browser outbound calls snapshot their agent assignment
in the creation transaction and use it when the remote answer arrives.

Wave 8d-3 adds the [IVR API and runtime](ivr.md). A gateway number with
`routing: {kind: "ivr", ivrId}` automatically accepts inbound calls through Graph
and routes into its configured menu tree. Call reads include the IVR path/outcome;
`whatsapp.call.ivr_completed` reports the final menu action or handoff.
