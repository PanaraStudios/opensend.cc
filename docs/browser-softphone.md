# Browser agents (wave 8c)

The dashboard shell owns one SIP.js 0.21.2 softphone per team member and browser.
Choose **Go online** to grant microphone access, unlock the ring sound, register
`2000`–`2099` over WSS and publish online presence. **Set away** hangs up the
current call, unregisters and revokes the session credential. Navigation inside
the dashboard keeps the browser leg alive. Changing team, signing out or leaving
the dashboard disposes it. Reload recovery is not implemented.

Incoming gateway calls notify online agents through the existing toast, dialog and
an audio ring. A Convex mutation claims the call atomically; one winner can answer.
Microphone permission is checked before Graph acceptance. FreeSWITCH bridges to the
winner only after `accept` succeeds. Outbound calls reserve the agent in the call
creation transaction, check Meta permission again on the server, and bridge to the
browser after the remote SDP answer. API-mode calls retain the integrator flow.

The dialog provides mute, local hold/resume, transfer, a DTMF keypad, hangup and a
timer. Mute disables the browser sender; DTMF uses SIP.js's WebRTC DTMF sender.
Hold gates FreeSWITCH audio in both directions with `uuid_audio`; it does not send
an SDP update to Janus or Meta. Transfers use `uuid_transfer` on the anchored
FreeSWITCH leg. A target agent is reserved atomically before external routing.
Agent transfers are within the same team. Queue choices come only from the
operator's allowlist; queue definitions remain wave 8d.

**Messages → Calls** lists calls and the first 100 team members (matching the
controller's 100-slot capacity), including away members without a softphone session.
Presence expires after 75 seconds without a heartbeat. Browser credentials expire
after 120 seconds and refresh every 30 seconds. Extension reuse is quarantined
past the old registration lifetime. Passwords exist only in gateway/browser memory,
never in Convex rows, localStorage, environment variables exposed to the browser,
or application logs. Gateway restarts lose registrations and active calls.

Contacts have **Call** on each linked WhatsApp account. The permission dialog offers
**Request permission** when Meta permits it. The existing message pipeline enforces
the 24-hour window; use the existing permission-template API outside that window.
Meta's limits and errors remain authoritative. The server rechecks permission when
placing the call, so stale UI permission cannot bypass the gate.

`components/dashboard/calling/call-event-bubble.tsx` exports `CallEventBubble` for
the conversation restyle to import. It uses the existing `Bubble` primitive and
theme tokens. `CallButton` is also independently exported for the later header
integration. No files under `components/dashboard/conversation/` are changed.

## Operator configuration (required before browser media works)

The bundled FreeSWITCH image now builds and loads `mod_xml_curl` before Sofia.
Its directory binding below replaces the old shared-password users entirely,
including gateway slots. The image has an empty static directory and removes
previously generated user files on startup. Do not add static users or directory
cache attributes as a fallback. Restart the old FreeSWITCH instance when upgrading
so cached credentials and registrations cannot survive the change.

The pinned image is now FreeSWITCH 1.11.3 with Sofia-SIP 1.13.18 and SpanDSP 3.1.1.
The [8d-0 upgrade notes](calling-gateway.md#freeswitch-111-upgrade-8d-0) list dependency
changes and verify that XML-CURL, Sofia, Opus, the XML dialplan and all other loaded
modules survived the legacy module removals. `mod_http_cache` is added for future
IVR prompts. Rebuild Janus and FreeSWITCH and restart between calls; rerun both
the meta-peer and agent harness checks documented in that guide.

The simpler secure design uses **call-gateway as the directory proxy**. Convex's
existing authenticated `calling/softphone:session` action checks team/browser
ownership, then issues/refreshes a credential through the controller's HMAC
`POST /agents/session`. Passwords stay in controller memory; Convex stores only
the lease, extension and expiry. FreeSWITCH fetches that same live credential
through `POST /agents/directory`, using a separate shared Basic secret over the
private Compose network. There is no extra public Convex directory endpoint or
second credential store. XML-CURL cannot generate the per-request gateway HMAC.
The controller validates the directory secret at startup; both services must use
the same value. Never route `/agents/directory` through the public controller proxy.

Set on Convex:

```dotenv
CALL_GATEWAY_URL=http://call-gateway:8090
CALL_GATEWAY_SECRET=<existing gateway HMAC secret>
CALL_AGENT_WSS_URL=wss://calling.example.com:7443
CALL_AGENT_QUEUES={"TEAM_ID":["support","sales"]}
```

Set on **both FreeSWITCH and the controller** (Compose passes these through):

```dotenv
FREESWITCH_DIRECTORY_SECRET=<separate random 64-character hex secret>
CALL_AGENT_QUEUES={"TEAM_ID":["support","sales"]}
```

The JSON queue allowlist must match on both services and uses actual organization IDs. Each team has its own destinations. Leave it empty to offer only agent
transfers. Operators define `queue-TEAM_ID-support` and `queue-TEAM_ID-sales` extensions in the
`calling` dialplan context with their existing local VoIP queue application; the
controller never accepts arbitrary SIP/PSTN destinations. Do not enable queue
choices until those extensions exist.

The shipped configuration renders this binding automatically. For an existing
operator build, load `mod_xml_curl` before Sofia and use this directory override
(substitute the actual secret and restrict this private endpoint to FreeSWITCH):

```xml
<configuration name="xml_curl.conf" description="Ephemeral agent directory">
  <bindings>
    <binding name="opensend-agents">
      <param name="gateway-url" value="http://call-gateway:8090/agents/directory" bindings="directory"/>
      <param name="gateway-credentials" value="directory:REPLACE_WITH_DIRECTORY_SECRET"/>
      <param name="auth-scheme" value="basic"/>
      <param name="timeout" value="3"/>
    </binding>
  </bindings>
</configuration>
```

The endpoint returns dynamic, uncached directory XML for live browser sessions and
`1000`–`1099` gateway SIP users. It returns `not found` for expired/unknown agents.
Browser users receive the empty `softphone-deny` context: do not define routes in
that context. All call routing is authorized through Convex and the HMAC gateway.
The directory uses a separate Basic credential because FreeSWITCH XML-CURL cannot
produce the gateway's per-request HMAC envelope. Use private networking or HTTPS;
never expose the directory endpoint publicly. The controller's host mapping is
loopback-only. If using XML-CURL over HTTPS outside the private network, explicitly
set `enable-cacert-check=true` and `enable-ssl-verifyhost=true` (the pinned module's
defaults do not verify HTTPS), and provide `ssl-cacert-file` for a private CA.

Sofia retains `wss-binding=:7443`, realm/registration domain `freeswitch`,
Opus/48k at 20 ms, DTLS-SRTP and the configured public RTP mapping. The bridge
exports `media_webrtc=true` only on the browser leg. Sofia's candidate ACLs accept
both private LAN/Docker candidates and public/relay candidates. Set
`CALL_AGENT_WSS_URL=wss://calling.example.com:7443` on Convex. Configure
`FREESWITCH_PUBLIC_IP` and forward UDP 20400–20799 for public browser media.

### WSS certificate

The WSS certificate differs from the self-signed P-256 DTLS media certificate.
By default startup creates `/certs/wss.pem` with localhost, 127.0.0.1 and
`freeswitch` SANs in the certificate volume. This is only for local development:
normal browsers reject it unless explicitly trusted. Use a local trusted CA or
import the development certificate into your local trust store. The Docker agent
harness alone uses Chromium's certificate-error bypass; the dashboard does not.

On a VPS, obtain a publicly trusted certificate (for example Let's Encrypt) for
`calling.example.com`. Assemble **private key followed by the full certificate
chain** into `wss.pem`, readable by container UID 10002, in a protected host
directory. Set `FREESWITCH_CERT_DIR=/absolute/path/to/calling-certs` in the Compose
env file. For a read-only certificate mount use an override:

```yaml
services:
  freeswitch:
    volumes:
      - /absolute/path/to/calling-certs:/certs:ro
```

The file must exist before startup with a read-only mount. On renewal, replace
`wss.pem` atomically and restart FreeSWITCH between calls so Sofia loads it.
Do not reuse this certificate as the independent DTLS certificate.

### Optional TURN for agents

The optional [coturn service](calling-gateway.md#optional-agent-turn) is off by
default. It relays only the browser-to-FreeSWITCH leg. The current dashboard
adapter uses host candidates and does not automatically distribute TURN
credentials: operators enabling TURN must supply `iceServers` to their SIP.js
adapter's `sessionDescriptionHandlerFactoryOptions.peerConnectionConfiguration`.
See the gateway guide for credentials, ports and an example. Meta/Janus never
uses this TURN server.

Configuration was checked against [SIP.js's FreeSWITCH guide](https://sipjs.com/guides/server-configuration/freeswitch/),
[receiving calls](https://sipjs.com/guides/receive-call/),
[DTMF](https://sipjs.com/guides/send-dtmf/),
[SignalWire's WSS manual](https://developer.signalwire.com/freeswitch/users-and-endpoints/webrtc-sip/),
[XML-CURL manual](https://developer.signalwire.com/freeswitch/integration/xml-curl/),
and the pinned [FreeSWITCH 1.11.3 command implementation](https://github.com/signalwire/freeswitch/blob/v1.11.3/src/mod/applications/mod_commands/mod_commands.c).
SIP.js's installed 0.21.2 types were also checked: registration is considered ready
only after `onRegistered`, logging is disabled, and media uses audio without video.

## Schema and verification

`callAgents` is a new ephemeral operational table, separate from member profiles;
team retirement deletes it. `calls` gets optional agent lease/extension fields and
indexes for active calls by organization/mode/status and assigned agent/status.
No existing fields are removed or made required. Existing call documents need no
migration. The new indexes must finish backfilling before the softphone queries
run. On a large existing calls table, stage these indexes in an earlier deployment,
then activate them before deploying this UI. No deployment or codegen is run here;
the two generated API type files are registered by hand.

Unit tests cover the softphone state machine, permissions, timing, labels and DTMF.
Convex tests cover claim races, browser/team ownership, expiry, credential issuance,
revocation, transfer reservations and permission-request window enforcement.
Gateway tests cover ephemeral directory authentication/expiry and local controls.
The compiling `tests/e2e/softphone-flow.ts` is wired into the integration suite and
screenshots Calls and the contact permission dialog. The Docker `agent` check
registers real headless Chromium/SIP.js with backend-issued credentials, answers
a bridged inbound call, checks browser and fake-Meta RTP in both directions, and
verifies that a revoked credential cannot register again. It uses a fake
authenticated backend and bypasses only the local WSS certificate check. See
[verification output on FreeSWITCH 1.11.3](calling-gateway.md#freeswitch-1113-verification-2026-10-02).
It does not validate production certificate trust or public NAT/firewall routing.
Still verify trusted WSS, two browsers
racing to answer, two-way audio, mute, hold RTP continuity, agent/queue transfer,
DTMF and remote/local hangup with the operator configuration above. The US live
business number can validate UIC only, not business-initiated calling.
