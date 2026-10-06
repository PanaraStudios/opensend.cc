# Anonymous usage statistics

opensend.cc shares anonymous statistics with its owner's collector, on by default.
This helps the owner understand how many installations exist, whether they are
trying the product or using SES in production, and which features people use.
There are no page-load events or browser tracking scripts.

## Control sharing

The installation administrator can turn **Share anonymous usage statistics** off
in the setup wizard or in **Instance → Amazon SES**, beside the other instance
settings. It starts on. **View what's sent** builds the JSON from current usage
without contacting the collector. The timestamp and usage refresh when sent.
Turning sharing off stops the next ping, including one already queued. opensend.cc
does not send a goodbye ping.

For a hard off, set `OPENSEND_TELEMETRY=0` in the **Convex backend's environment**.
This takes precedence over the saved switch: no telemetry network request is
made, and the switch shows off and locked. Unset it or set it to `1` to use the
administrator's preference again; a missing preference defaults to on.

With the installer, use `--telemetry no` (or `--telemetry yes`, the default).
The installer writes `OPENSEND_TELEMETRY=0` or `1` to `.env`. Upgrades preserve
that value unless you explicitly supply the flag. With Compose, set it in `.env`
and rerun the migrate service to apply the environment to Convex. Both the
self-hosted and Convex Cloud Compose configurations forward the setting. For a
source installation or a Cloud deployment managed outside Compose, use
`pnpm exec convex env set OPENSEND_TELEMETRY 0` against that deployment.

## Delivery

opensend.cc sends once when setup completes, then from a daily Convex cron with up
to two hours of random scheduling jitter. Attempts are at least 24 hours apart,
even after failures. There is no immediate retry. An installation that enables
sharing later is picked up by the next daily cron.

Requests are `POST https://opensend.cc/api/telemetry`, with
`content-type: application/json` and a body of at most 8 KB. Override the collector
with `OPENSEND_TELEMETRY_URL` in the backend environment. The collector returns
`204` on success. opensend.cc uses a three-second request timeout, does not follow
redirects, ignores all errors and never logs the payload.

## Schema 1 payload

Every field below is required. There are no additional fields. All usage counts
use one of these ranges: `"0"`, `"1-9"`, `"10-99"`, `"100-999"`, `"1k-9k"`, `"10k+"`.
Exact feature counts are never sent.

```json
{
  "schema": 1,
  "installationId": "18f5b149-bbd7-48e8-bc04-f2eaad4d0de7",
  "sentAt": "2026-10-06T12:00:00.000Z",
  "version": "2.0.0",
  "deployment": {
    "backend": "self-hosted",
    "installMethod": "script",
    "arch": "amd64",
    "calling": false
  },
  "installedDays": 12,
  "usage": {
    "teams": "1-9",
    "members": "1-9",
    "domainsVerified": "1-9",
    "sesProduction": true,
    "emailsSent24h": "10-99",
    "emailsReceived24h": "0",
    "broadcasts30d": "1-9",
    "automationsActive": "0",
    "webhookEndpoints": "0",
    "apiKeys": "1-9",
    "apiRequests24h": "10-99",
    "sdkRequests24h": "1-9",
    "mcpRequests24h": "0",
    "smtpUsed30d": false,
    "ssoEnabled": false,
    "whatsappAccounts": "0",
    "messengerPages": "0",
    "instagramAccounts": "0",
    "channelMessages24h": "0",
    "calls30d": "0",
    "ivrs": "0",
    "voiceBots": "0"
  }
}
```

- `installationId` is a random UUID v4, generated once and stored in the
  installation row. It identifies an installation across pings, not a person.
- `sentAt` is an ISO 8601 timestamp. `version` is the installed product version.
- `deployment.backend` is `self-hosted` or `convex-cloud`.
  `installMethod` is `script`, `compose`, `source` or `unknown`; `arch` is
  `amd64`, `arm64` or `unknown`. `calling` is true only when the backend has
  `OPENSEND_CALLING=1`. The installer saves `yes`, so script-enabled calling can
  be reported as false.
- `installedDays` is the number of whole days since the installation row was
  created, including installations that predate telemetry.
- `teams` counts teams; `members` counts team memberships, so one person in two
  teams counts twice. `domainsVerified` counts verified, undeleted domains.
- `sesProduction` is true if any configured SES region has production access,
  false if configured regions are all in the sandbox, and `null` if unknown
  (SES is not set up). It does not label all non-SES installations as testing.
- `emailsSent24h` and `emailsReceived24h` use existing retained usage counters.
  Email, API and channel-message counters cover the latest complete 24 hours
  aligned to their 15-minute buckets.
- `broadcasts30d` counts broadcasts created in the past 30 days.
  `automationsActive` counts enabled, undeleted automations.
  `webhookEndpoints` counts configured endpoints; `apiKeys` counts current keys.
- `apiRequests24h` counts API-source requests. SDK and MCP requests are recognized
  by the standard `opensend-node:` and `opensend-mcp:` user-agent prefixes;
  custom user agents cannot be recognized. These are subsets of API requests.
- `smtpUsed30d` indicates an SMTP request in the past 30 days, including the
  current partial counter bucket;
  `ssoEnabled` indicates at least one team enforcing SSO.
- `whatsappAccounts`, `messengerPages` and `instagramAccounts` count connected
  channel endpoints. `channelMessages24h` counts channel messages;
  `calls30d` counts calls created in the past 30 days, including test calls.
  `ivrs` and `voiceBots` count configured IVRs and voice bots.

Usage counting stops at the `10k+` range. Statistics do not need exact totals
above that range.

Compose supplies backend and installation method metadata. The installer also
supplies architecture. `pnpm setup` records the source installation method and
architecture. Other source deployments can set `OPENSEND_INSTALL_METHOD=source`,
`OPENSEND_ARCH=amd64|arm64`, and `OPENSEND_VERSION` to a release version. When
the version has a leading `v`, it is removed. Empty or invalid overrides in
release images use the release version baked into the migrate image, which
writes the resolved version to Convex before deploying. Without a valid version,
the payload uses `0.0.0-unknown`. When calling services are enabled, set
`OPENSEND_CALLING=1` in the backend; other values report false. Script installs
save `yes`, so their calling flag can be false even with calling enabled. Values
outside the supported method and architecture labels become `unknown`. No hostname or URL is included in deployment metadata.

## What is never sent

Emails, names, domains, hostnames, IP addresses, team or user IDs, message
content, keys and URLs are never included in the payload. The collector URL and
installation URLs are not payload fields. The collector necessarily receives
the network connection from the backend; its handling of connection metadata
belongs to the separately maintained collector.
