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

No Docker files, images or running deployments are changed in 8c. The shipped 8b
image has a static shared-password agent directory and does **not** build
`mod_xml_curl`; that configuration cannot authenticate expiring credentials.
An operator must supply a FreeSWITCH build containing `mod_xml_curl` and replace
its configuration with the directory binding below. Keep the existing media/Sofia
settings and gateway dialplan from 8b. Remove the static directory users
`2000`–`2099` entirely, including generated files and cached directory entries.
Never leave the shared agent password as a fallback.

Set on Convex:

```dotenv
CALL_GATEWAY_URL=http://call-gateway:8090
CALL_GATEWAY_SECRET=<existing gateway HMAC secret>
CALL_AGENT_WSS_URL=wss://calling.example.com:7443
CALL_AGENT_QUEUES={"TEAM_ID":["support","sales"]}
```

Set on the controller:

```dotenv
FREESWITCH_DIRECTORY_SECRET=<separate random 64-character hex secret>
CALL_AGENT_QUEUES={"TEAM_ID":["support","sales"]}
```

The JSON queue allowlist must match on both services and uses actual organization IDs. Each team has its own destinations. Leave it empty to offer only agent
transfers. Operators define `queue-TEAM_ID-support` and `queue-TEAM_ID-sales` extensions in the
`calling` dialplan context with their existing local VoIP queue application; the
controller never accepts arbitrary SIP/PSTN destinations. Do not enable queue
choices until those extensions exist.

Load `mod_xml_curl` before Sofia. Add the following configuration section to the
operator's FreeSWITCH configuration (substitute the actual secret; restrict this
private HTTP endpoint to the FreeSWITCH host):

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
never expose the directory endpoint publicly.

Retain Sofia `wss-binding=:7443`, realm/registration domain `freeswitch`, Opus/48k
at 20 ms, DTLS-SRTP, public RTP mapping, and a trusted WSS certificate in `/certs`.
The WSS certificate differs from the DTLS media certificate. A self-signed WSS
certificate fails browser registration. This browser adapter uses host ICE
candidates; restrictive networks needing TURN remain an operator integration task.

Configuration was checked against [SIP.js's FreeSWITCH guide](https://sipjs.com/guides/server-configuration/freeswitch/),
[receiving calls](https://sipjs.com/guides/receive-call/),
[DTMF](https://sipjs.com/guides/send-dtmf/),
[SignalWire's WSS manual](https://developer.signalwire.com/freeswitch/users-and-endpoints/webrtc-sip/),
[XML-CURL manual](https://developer.signalwire.com/freeswitch/integration/xml-curl/),
and the pinned [FreeSWITCH 1.10.12 command implementation](https://github.com/signalwire/freeswitch/blob/v1.10.12/src/mod/applications/mod_commands/mod_commands.c).
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
screenshots Calls and the contact permission dialog. Docker e2e and real WebRTC
media are deliberately left for integration: verify trusted WSS, two browsers
racing to answer, two-way audio, mute, hold RTP continuity, agent/queue transfer,
DTMF and remote/local hangup with the operator configuration above. The US live
business number can validate UIC only, not business-initiated calling.
