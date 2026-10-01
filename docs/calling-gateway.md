# Calling media gateway (wave 8b)

The `calling` Compose profile supplies Janus, FreeSWITCH and a private Node controller.
Convex remains responsible for Meta webhooks, Graph signaling, call authorization and
tenant isolation. This task adds no Convex functions or dashboard screens. Use Graph
signaling with Meta's SIP mode **disabled**. All call legs stay on VoIP.

## Source builds and pins

| Component                        | Pin                                                                                                          | Official installation/reference                                                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Janus                            | 1.2.3, commit `a71f9cecb72b47fc3d3a7effc575ad6b21a1f4f4`                                                     | [Janus installation](https://janus.conf.meetecho.com/docs/README.html), [pinned README](https://github.com/meetecho/janus-gateway/blob/v1.2.3/README.md), [SIP plugin](https://janus.conf.meetecho.com/docs/sip.html) |
| FreeSWITCH                       | 1.10.12, commit `a88d069d6ffb74df797bcaf001f7e63181c07a09`                                                   | [Official source/package installation](https://developer.signalwire.com/freeswitch/foundations/getting-started/), [release](https://github.com/signalwire/freeswitch/releases/tag/v1.10.12)                           |
| Sofia-SIP, both images           | 1.13.17, commit `6198851a610b7889c17e2d98fb84617bc1dd7aec`                                                   | [Official release](https://github.com/freeswitch/sofia-sip/releases/tag/v1.13.17)                                                                                                                                     |
| SpanDSP                          | commit `0d2e6ac65e0e8f53d652665a743015a88bf048d4`                                                            | [FreeSWITCH 1.10.12's dependency pin](https://github.com/signalwire/freeswitch/blob/v1.10.12/w32/download_spandsp.props)                                                                                              |
| Native image base                | Debian 12.11 slim, digest `sha256:b1a741487078b369e78119849663d7f1a5341ef2768798f7b7406c4240f86aef`          | [Official Debian image](https://hub.docker.com/_/debian)                                                                                                                                                              |
| Controller/harness base          | Node 22.17.0 bookworm slim, digest `sha256:b04ce4ae4e95b522112c2e5c52f781471a5cbc3b594527bcddedee9bc48c03a0` | [Official Node image](https://hub.docker.com/_/node)                                                                                                                                                                  |
| Package manager / fake Meta peer | pnpm 11.7.0 / werift 0.24.4                                                                                  | [pnpm](https://pnpm.io/installation), [werift](https://github.com/shinyoshiaki/werift-webrtc)                                                                                                                         |

These media versions match Meta's **FreeSWITCH using Graph API with Janus** example
in [integration examples](https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/integration-examples).
The official FreeSWITCH install docs now live at `foundations/getting-started`; the
older `FreeSWITCH-Explained/Installation/Linux/Debian_67240088/` link redirects to the
manual home. Binary packages require a SignalWire Personal Access Token. Our source
build requires **no token**, builds Sofia and SpanDSP from fixed commits, selects a
small module list, and uses `bootstrap.sh`, `configure`, `make`, `make install`.
Janus uses the official `autogen.sh`, `configure`, `make`, `make install` sequence,
building only the SIP plugin and HTTP transport. Native Debian dependencies come
from the fixed `20250630T000000Z` bookworm archive snapshot. HTTP transport to the
snapshot is authenticated by Debian's signed repository metadata.

Three changes to pinned Janus are in `docker/janus/meta-interop.patch`:

1. Always create a controlling, full-mode libnice agent. Janus 1.2.3 otherwise
   starts **controlled** when answering a remote offer. This image is dedicated
   to Meta ICE-lite peers; never use it as a general browser gateway.
2. Wait for ICE gathering to finish, removing the upstream five-second fallback
   that publishes partial candidates. Controller setup times out and destroys the
   session rather than returning an incomplete SDP.
3. Gate SIP-to-WebRTC RTP using the private `opensend_media` plugin message.
   The gate starts closed and opens only through `/route`. ICE/DTLS and RTCP may
   establish before routing; **RTP audio does not leave Janus** before routing.

FreeSWITCH's `ecdsa-dtls.patch` keeps valid P-256 certificates: upstream 1.10.12
compares every key's bit length to 4096 and regenerates an EC key as RSA. P-256
certificates are generated at startup for both media servers. WSS uses a separate
certificate from FreeSWITCH DTLS. Production WSS needs a publicly trusted hostname
certificate; self-signed DTLS certificates are expected and verified by SDP
fingerprints. Janus's DTLS certificate/key persist in `janus-certs`; rotate them
between calls, never during a call.

## Configuration and operation

Set these in an uncommitted `.env.calling` or the shell:

```dotenv
CALL_GATEWAY_SECRET=<random 64-character hex secret>
JANUS_API_SECRET=<different random 64-character hex secret>
FREESWITCH_ESL_SECRET=<different random 64-character hex secret>
FREESWITCH_SIP_SECRET=<different random 64-character hex secret>
FREESWITCH_AGENT_SECRET=<different random 64-character hex secret>
CALL_GATEWAY_CONVEX_HTTP_URL=http://convex:3211
JANUS_STUN_SERVER=stun.l.google.com
JANUS_STUN_PORT=19302
JANUS_PUBLIC_IP=<public IPv4 for 1:1 NAT, otherwise leave empty>
FREESWITCH_PUBLIC_IP=<public IPv4 for browser RTP>
```

Secrets must contain 32–128 alphanumeric, underscore or hyphen characters. Use
`openssl rand -hex 32` for each. Blank secrets fail at service startup; they do not
break Compose parsing when `calling` is not selected. The Convex HTTP site URL is
port **3211**, not its query/action API port 3210. Hosted deployments can set an
HTTPS site base URL instead. There must be a network path from Convex Node actions
to the controller. Self-hosted actions use `http://call-gateway:8090`; hosted
actions require a separately secured HTTPS reverse proxy to this private service.

Build/start the media services without starting the app or deploying Convex:

```sh
docker compose --env-file .env.calling --profile calling build janus freeswitch call-gateway
docker compose --env-file .env.calling --profile calling up -d janus freeswitch call-gateway
curl --fail http://127.0.0.1:8090/healthz
docker compose --env-file .env.calling --profile calling logs --tail=100 janus freeswitch call-gateway
```

Compose initializes named-volume ownership for the unprivileged image users.
For a trusted WSS certificate, override the FreeSWITCH `/certs` mount with a host
directory containing `wss.pem` (private key followed by full certificate chain),
readable by UID 10002. With a read-only mount, provide that file before starting.
The browser softphone registers over `wss://calling.example.com:7443`, authenticates
as an extension `2000`–`2099`, with SIP realm/domain `freeswitch`. Supply agent
credentials only to authorized agents in task 8c. The sample directory shares
one agent password; per-agent credentials and tenant-specific provisioning belong
to that integration before public use. Gateway slots `1000`–`1099` use a distinct
secret and are never exposed as browser accounts.

### Network and firewall

| Port                          | Scope                                  | Purpose                                                                |
| ----------------------------- | -------------------------------------- | ---------------------------------------------------------------------- |
| UDP 20000–20199               | Publish to Meta / VPS firewall         | Janus ICE, DTLS-SRTP, RTCP mux; one audio stream per call              |
| UDP 20200–20399               | Docker network only                    | Janus SIP plugin's SDES-SRTP/RTCP towards FreeSWITCH                   |
| UDP 20400–20799               | Publish to agents / VPS firewall       | FreeSWITCH media for browser agents; also used internally for SIP legs |
| TCP 7443                      | Publish to agents                      | SIP-over-WSS; trusted certificate required                             |
| UDP/TCP 5060                  | Docker network only                    | SIP registration/invites between Janus and FreeSWITCH                  |
| TCP 8021                      | Docker network only                    | FreeSWITCH ESL, password + private-network ACL                         |
| TCP 8088 / 7088               | Docker network only                    | Janus HTTP / Admin API, API shared secret                              |
| TCP 8090                      | Docker network + loopback host mapping | HMAC-authenticated controller; read-only health probe unsigned         |
| UDP 19302 outbound by default | STUN service                           | Janus public candidate discovery; configurable server/port             |

Keep media UDP mappings **1:1**, including port numbers. For a VPS behind 1:1 NAT,
set `JANUS_PUBLIC_IP` and forward the Janus range; private candidates are retained
for peers on the Compose network. STUN allows Janus to initiate outbound ICE checks
through NAT, but does not fix blocked UDP or arbitrary symmetric NAT. No Meta TURN
server exists. For restrictive browser-agent networks, optional coturn is configured
on the agent's `RTCPeerConnection` in task 8c, not on Meta's side. On Docker Desktop,
the local harness uses container host candidates on the shared network and disables
STUN; it does not validate public NAT/firewall behavior.

Only Opus/48000/2 at 20 ms is used as a speech codec, including on SIP legs.
`telephone-event/8000` is an optional DTMF payload retained when offered, so IVR
digits work without adding a second speech codec. Video and data m-lines are
rejected, G.711/RED/RTX are removed, Opus DTX is disabled, and FreeSWITCH uses
the soft RTP timer to send media without waiting for the caller. Janus uses regular
ICE nomination, ICE-full controlling, P-256 DTLS certificates and a DTLS client role.
Local answers advertise `setup:active`; outbound offers use `actpass` and require
Meta's answer to choose `passive`. No trickle requests, updates, ICE restarts or
WebRTC renegotiation are issued. Local SDP contains complete candidates and
`end-of-candidates`, with exactly one audio m-line and at most one SSRC.

## Internal API (calling-core contract)

All five operations are HTTP POST with JSON, signed using `CALL_GATEWAY_SECRET`.
The API is private; callers must apply team/call ownership checks first. `callId`
is a stable Convex call-row id chosen before outbound Graph `connect`, so it need
not change when Meta assigns a wacid. It must match `[a-zA-Z0-9._:-]{1,256}`.

| Path            | Request                                                                         | Success (200)   |
| --------------- | ------------------------------------------------------------------------------- | --------------- |
| `/inbound`      | `{ callId, offerSdp }`                                                          | `{ answerSdp }` |
| `/outbound`     | `{ callId }`                                                                    | `{ offerSdp }`  |
| `/remoteAnswer` | `{ callId, sdp }`                                                               | `{ ok: true }`  |
| `/hangup`       | `{ callId }`                                                                    | `{ ok: true }`  |
| `/route`        | `{ callId, target: "agent" \| "ivr" \| "queue" \| "bot", extension?, record? }` | `{ ok: true }`  |

`agent` requires a local `2000`–`2099` extension. `ivr` runs the bundled spoken
demo (1: tone, 2: repeat). `record: true` starts a mixed mono WAV in
`/recordings/<FreeSWITCH UUID>.wav` before the route plays/bridges. `queue` and `bot`
are recognized but return **501 ROUTE_NOT_IMPLEMENTED** because they belong to 8d.
`outbound()` registers a per-call Janus SIP slot and uses FreeSWITCH ESL to originate
an Opus/SDES-SRTP `user/<slot>@freeswitch` leg. Its SIP INVITE becomes the Janus
WebRTC offer. `remoteAnswer()` applies the Meta answer with Janus SIP `accept`.
Both directions park their FreeSWITCH leg until `route()` decides the endpoint.

UIC integration sequence:

1. Call `inbound(offerSdp, callId)`. Store the returned SDP; duplicate requests with
   the same id/offer return the same answer.
2. Optionally send Graph `pre_accept` with that answer. Use the same answer for
   Graph `accept`. The controller still blocks outgoing RTP.
3. **Only after Graph `accept` returns 200**, call `route()` to release RTP and
   connect the agent or IVR. Do not call it merely on `answer_ready` or `media_up`.
4. On rejection, remote terminate, action failure or acceptance timeout, invoke
   `hangup()`. Convex also sends Graph `terminate` as appropriate.

BIC integration sequence: `outbound(callId)` → Graph `connect` with `offerSdp` →
connect webhook's SDP answer → `remoteAnswer(callId, sdp)` → `route()`.
No PSTN destinations can be selected through this API.

The controller supports 100 simultaneous slots. Setup/routing must complete within
60 seconds; abandoned parked calls are reaped. Established calls have no duration
cap. Equal repeated setup/answer/route/hangup operations are idempotent; conflicting
SDPs/routes return 409. Hangup interrupts setup and leaves a five-minute tombstone
to refuse delayed recreation. Convex must persist dedupe/stale-event checks across
controller restarts. Route changes/transfers and browser claiming belong to 8c.

Errors have `{ error: { code, message } }`, with 400 for invalid input/SDP, 401 for
auth failures/replays, 404 for missing calls, 409 for state conflicts, 413 for bodies
over 128 KiB, 501 for reserved routes, 502 for media-server failures, 503 for
unavailable/capacity, and 504 for setup timeouts. `/healthz` returns `{ ok }` with
200/503 and checks both ESL connectivity and Janus's full/non-trickle settings.

### HMAC envelope

The typed `CallGatewayClient` and `signRequest` live in
`services/call-gateway/src/client.ts` and `src/auth.ts`. They are usable in **Node**
actions (no Convex dependency). Headers:

```text
x-call-gateway-timestamp: <Unix seconds, 10 decimal digits>
x-call-gateway-nonce: <fresh UUID>
x-call-gateway-signature: sha256=<64 lowercase hex digits>
```

Canonical UTF-8 input, with LF separators and no trailing LF:

```text
<timestamp>\n<nonce>\n<UPPERCASE HTTP METHOD>\n<absolute URL pathname>\n<lowercase hex SHA256 of exact raw body bytes>
```

Compute HMAC-SHA256 with the UTF-8 shared secret. Sign the exact JSON string sent
on the wire, not a reparsed object. Method/path/body/timestamp/nonce are all bound.
The verifier accepts ±60 seconds of clock skew, compares signatures in constant
time, and rejects reused nonces. Retries use fresh nonces. Do not redirect signed
requests. Sync clocks and use private networking or HTTPS. Query strings are not
part of this API's contract and are rejected by the controller.

## Callback contract (implemented in calling core later)

`ConvexCallbacks` POSTs to
`${CALL_GATEWAY_CONVEX_HTTP_URL}/calling/gateway/events`, using the same HMAC envelope.
Task 8a must add the receiver; **none exists in this task**. Convex HTTP actions use
Web Crypto to verify HMAC over raw request text, since `node:crypto` cannot be
imported into their default runtime. Apply the ±60-second window and persist
nonce replay protection and `eventId` dedupe. Return 200 for known duplicate events.

The discriminated TypeScript contract is `GatewayCallback` in `src/contracts.ts`:

```ts
type Envelope = {
  version: 1
  eventId: string // UUID, unchanged on callback retry
  callId: string // stable internal call id, not necessarily the wacid
  timestamp: number // Unix milliseconds at event creation
}
type Event = Envelope &
  (
    | { event: "answer_ready"; answerSdp: string }
    | { event: "offer_ready"; offerSdp: string }
    | { event: "media_up" }
    | { event: "hangup"; reason: string }
    | { event: "recording_ready"; recordingFile: string }
  )
```

`answer_ready`/`offer_ready` repeat the synchronous API results; use them for
recovery, not a second Graph action. `media_up` means Janus observed incoming
audio RTP (not merely ICE or DTLS ready). `hangup` is advisory media teardown;
calling core reconciles it against Meta lifecycle timestamps and always owns
Graph terminate. `recording_ready` follows FreeSWITCH `RECORD_STOP`, after file
finalization, and may arrive after `hangup`. Never reopen a terminated call because
of an out-of-order callback.

Recording files persist in `calling-recordings`; the receiver gets a path, **not
a public URL**. A later storage uploader with access to this volume must consume
the finalized file and invoke the existing storage helper. Upload/storage code is
outside 8b, and was deliberately not added to `convex/` or `lib/`.

Callbacks retry transport failures, HTTP 429 and 5xx up to five attempts (5-second
attempt timeout, exponential 250 ms backoff). Other 4xx stop retrying and failures
log only event id/type. Retries use the same event id/body and a new HMAC nonce.
Callbacks and live sessions are in memory: a controller restart drops calls and
unsent events. There is no durable outbox or automatic session recovery in 8b.

## Lead harness: exact commands

The harness uses werift's actual **ICE-lite controlled mode** with no STUN/TURN,
ECDSA DTLS and Opus RTP. Its fake HMAC-authenticated callback receiver replaces
Convex only in the test overlay. Both UIC and BIC are exercised. It asserts complete
SDP, ICE-full controlling via Janus Admin state, DTLS client/SRTP readiness, no RTP
before routing, gateway media sent first, bidirectional RTP, one SSRC, callbacks,
idempotent retries, and a finalized nonempty recording file. It is runnable entirely
on the Docker network; no Meta credentials or real Convex routes are needed.

From the repository root, generate an uncommitted harness env file:

```sh
umask 077
for name in CALL_GATEWAY_SECRET JANUS_API_SECRET FREESWITCH_ESL_SECRET FREESWITCH_SIP_SECRET FREESWITCH_AGENT_SECRET; do
  printf '%s=%s\n' "$name" "$(openssl rand -hex 32)"
done > .env.calling-test

c() { docker compose --env-file .env.calling-test -f compose.yaml -f docker/compose.calling-test.yaml --profile calling --profile calling-test -p opensend-calling-test "$@"; }
c build janus freeswitch call-gateway meta-peer; c up -d --force-recreate janus freeswitch call-gateway; c run --rm --use-aliases meta-peer
c down
```

Expect two `PASS` lines and exit 0. `--use-aliases` lets callback requests resolve
the ephemeral `meta-peer` container. The test override disables external STUN and
sets the callback base to `http://meta-peer:8091`. For diagnosis use the same Compose
function with `c logs --tail=200 janus freeswitch call-gateway`. The explicit project
name isolates these containers, network and named volumes from the application.
`c down` removes the test containers/network and retains its certificates and
recordings. Do not use `-v` or operate on another project's containers or volumes.
Remove the test overlay when restoring real callbacks.

If registration succeeds but an inbound call gets SIP `404 Not Found` with
`NO_ROUTE_DESTINATION`, check the dialplan provider as well as the XML data:

```sh
c exec -T freeswitch sh -c '/opt/freeswitch/bin/fs_cli -H 127.0.0.1 -p "$FREESWITCH_ESL_SECRET" -x "show dialplan"'
c exec -T freeswitch sh -c '/opt/freeswitch/bin/fs_cli -H 127.0.0.1 -p "$FREESWITCH_ESL_SECRET" -x "sofia global siptrace on"'
```

`show dialplan` must include `XML` from `mod_dialplan_xml`. The module is built in
`docker/freeswitch/modules.conf` and loaded by the rendered configuration. Having
the `calling` context in `xml_locate dialplan` alone does not prove it can execute.
The controller lets setup waiters consume terminal SIP events before closing the
Janus session, so a rejected INVITE reports its SIP cause instead of `Session closed`.

Local checks:

```sh
pnpm install --frozen-lockfile
pnpm --filter @opensendcc/call-gateway run test
pnpm --filter @opensendcc/call-gateway run typecheck
pnpm --filter @opensendcc/call-gateway run build
pnpm typecheck
pnpm lint
```

The isolated Docker harness was run on 2026-10-01: both inbound and outbound
printed `PASS` and the command exited 0. Root typecheck/lint and all 30 gateway
unit/protocol tests passed. Public NAT/UDP mapping, trusted browser WSS, IVR DTMF
with an actual Meta phone, source build linkage on other target architectures and
real Meta interoperability remain runtime checks. These older pins are deliberate
for the documented Meta example, not a
claim of current security patch level; update pinned sources, base digests and
Debian snapshot together after proving the harness still passes. Queue/bot routes,
per-agent credential provisioning, durable callback recovery, upload workers,
browser UI and real Graph signaling remain in their separate tasks.

Wave 8c adds expiring browser-agent sessions, an authenticated XML-CURL directory,
and `/control` for local hold/resume/transfer. See [browser softphone deployment](browser-softphone.md)
for the required FreeSWITCH directory override; the static 8b agent password must
be removed before using browser agents. Docker configuration is unchanged.
