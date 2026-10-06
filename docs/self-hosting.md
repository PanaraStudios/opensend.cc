# Self-hosted Opensend

For direct file uploads and configuring Convex’s built-in S3-compatible backend,
see [Convex file storage](object-storage.md).

Opensend runs as a Docker Compose stack: the Next.js dashboard, a self-hosted Convex backend that stores every team's data and runs sending, events, webhooks and automations, and an optional SMTP gateway. Amazon SES sends and receives the mail. Authentication and team administration use Better Auth 1.6.15 in a locally installed Convex component.

## v2 on a VPS

v2 adds WhatsApp, Messenger and Instagram. Email still uses Amazon SES. You can
install for Meta messaging without configuring AWS. The optional `calling`
profile adds Janus, FreeSWITCH, drachtio, call-gateway and voice-agent; the separate
`calling-turn` profile adds coturn. Messaging works without either profile.

### Requirements and firewall

Use a Linux VPS with Docker and Compose **2.24.4 or newer**, on amd64 or arm64.
The Compose add-ons use `!override`, which older Compose versions cannot read.
Plan for 4 GB RAM for messaging, and at least 8 GB for calling. Voice bots and
many concurrent calls need more; these are starting sizes, not capacity promises.
Keep enough disk space for the database, file storage, images, recordings, and a
compressed backup of the entire Convex volume before each upgrade.

Point the app, API and realtime DNS names at the VPS before starting Caddy.
Calling also needs a DNS name, a stable public IPv4 address (direct or 1:1 NAT),
and a trusted certificate for that calling name. IPv6-only VPSes and arbitrary
symmetric NAT are not supported by the scripted calling setup.

| Inbound ports    | Needed for                                                           |
| ---------------- | -------------------------------------------------------------------- |
| TCP 80, 443      | Dashboard, API, Meta callbacks and realtime WebSockets through Caddy |
| UDP 443          | Caddy HTTP/3; optional if your firewall blocks it                    |
| TCP 7443         | Browser calling over WSS, with a trusted certificate                 |
| UDP 20000–20199  | Meta to Janus media                                                  |
| UDP 20400–20799  | Browser to FreeSWITCH media                                          |
| TCP and UDP 3478 | Optional TURN listener                                               |
| TCP 5349         | Optional TLS TURN listener                                           |
| UDP 20800–20999  | Optional TURN relays                                                 |

Open the calling ports in both the provider firewall and the host firewall.
Forward media ports **1:1**, with the same numbers inside and outside Docker.
An HTTP reverse proxy cannot carry the UDP media. Do not publish SIP 5060, ESL
8021, Janus 8088/7088, or drachtio 9022. The gateway's 8090 host mapping stays on
loopback. UDP 20200–20399 is private Janus-to-FreeSWITCH media; leave it private.
Allow outbound HTTPS for Meta, SES and voice providers, plus DNS and Janus STUN
(UDP 19302 by default). Docker's published ports can bypass host firewall rules;
check the provider firewall and Docker firewall rules as well.

### Fresh install

Once a v2 release has been published, the normal installer command uses its
prebuilt images. This branch only defines the release workflow; it does not
publish images or update the installer served by opensend.cc.

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- install \
  --domain mail.example.com --api-domain api.mail.example.com \
  --realtime-domain realtime.mail.example.com --calling no --yes
```

Add `--version TAG` to choose a published v2 release. No source checkout or build
tools are needed. Keep the default installation directory when upgrading, or
always pass the same `--dir`. Create and verify the first account, then follow the
installation wizard: choose channels, check the public callback URL, and configure
SES, the Meta app, or both. The API hostname serves callbacks as well as REST;
the realtime hostname is for browser updates. Meta credentials belong in the
administrator's Meta form, not installer flags or shell history.

For calling, first obtain a trusted certificate for `calling.example.com` using
your existing certificate manager. FreeSWITCH reads `wss.pem`, containing the
private key followed by the full certificate chain. For example, after issuance:

```sh
sudo install -d -m 700 -o 10002 -g 10002 /srv/opensend-calling-certs
sudo sh -c 'cat /etc/letsencrypt/live/calling.example.com/privkey.pem /etc/letsencrypt/live/calling.example.com/fullchain.pem > /srv/opensend-calling-certs/wss.pem'
sudo chown 10002:10002 /srv/opensend-calling-certs/wss.pem
sudo chmod 600 /srv/opensend-calling-certs/wss.pem

curl -fsSL https://opensend.cc/install.sh | sh -s -- install \
  --domain mail.example.com --calling yes \
  --calling-domain calling.example.com --calling-public-ip 203.0.113.10 \
  --calling-cert-dir /srv/opensend-calling-certs --yes
```

Replace the example IP with your VPS public IPv4. The installer generates separate
secrets, saves the profiles in `.env`, and supplies the gateway URL, gateway secret
and WSS URL to Convex through the migrate container. It never prints these secrets.
On renewal, replace `wss.pem` atomically, preserve its permissions, and restart
FreeSWITCH between calls. Caddy's app certificate does not configure FreeSWITCH's
certificate. Self-signed DTLS certificates are expected; the browser WSS
certificate must be trusted. `--local` permits a local test certificate.

To change default ports on a new installation, pass `--calling-wss-port`,
`--janus-rtp-range`, `--freeswitch-rtp-range`, `--turn-port`, and
`--turn-relay-range`. Ranges use `START-END`; the installer rejects overlaps and
updates both Docker mappings and media server settings. Saved values win on
subsequent runs. `--no-start` prepares files without deploying or taking a data
backup; review and start them by re-running install without that flag. It may
still use the backend image to generate the admin key.

TURN is optional: add `--turn yes` when browser agents behind strict NAT or
firewalls get no audio. The installer generates and preserves `CALL_TURN_SECRET`
and sets `CALL_TURN_URLS`; migration supplies both to Convex. Agents receive
one-hour HMAC credentials tied to their owned softphone session, refreshed before
expiry. The shared secret stays on the server. Without both variables, browsers
use `CALL_STUN_URLS` (default `stun:stun.l.google.com:19302`) only. Open TCP/UDP
3478 and UDP 20800–20999, or the saved TURN ports; for optional TLS TURN configure
certificates and open TCP 5349. See
[optional TURN](browser-softphone.md#optional-turn-for-agents) for environment,
TLS configuration, credential details and relay diagnostics. Meta-to-Janus
media never uses this TURN server. Voice provider credentials and bot settings
are configured in the dashboard; starting voice-agent does not configure a bot.

### Upgrade from v1 to v2

Use the v2 installer and a published v2 tag, in the existing install directory:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- upgrade \
  --dir ./opensend --version TAG --yes
# --upgrade is an alias for the upgrade command.
```

The installer preserves existing hostnames, the Compose project name, backend
image, auth/encryption secrets and image overrides. If you have custom app,
migrate, SMTP or calling image overrides, supply their new image names in the
environment on upgrade. Do not change the project name or move the installation
directory as part of this upgrade. Calling stays off unless you opt in.

The upgrade fetches assets first, then stops the old stack and archives the
**actual mounted Convex data volume**. This includes the database, auth component
and local file storage. If the containers were removed with `docker compose down`,
it finds the retained volume using the saved Compose project labels. It saves
`convex-data.tar.gz`, the old private `env`, Compose files, proxy files and backend
image identity under `backups/<timestamp>/`. A backup failure stops the upgrade
before changing the live configuration or pulling new images. Services may stay
stopped; fix the failure and re-run. Copy the backup to another machine, and
regularly rehearse restoring it into a separate project and volume.

After backup, the installer pulls images, starts Convex, runs the one-shot migrate
image to set the backend environment and deploy functions, requests the resumable
`migrations:backfillCounts` backfill, then starts the application and any selected
media services. The backfill runs in the background; older row totals may read
low until it finishes. A failed deployment does not start the application or
calling stack. The previous volume is never deleted. The migrate image deploys
code and schema; there is no separate v2 data-conversion entrypoint today.

Keep the backup and old images. For a failed upgrade, inspect `docker compose logs
migrate convex`. Before deployment started, the old saved files and images can
be restored and restarted. After deployment changed the database, rehearse
recovery from the saved volume and environment into a **new** project; older
binaries may not understand the upgraded database. Never restore over the only
working volume. Back up separately configured S3 storage as described in
[Convex file storage](object-storage.md); the local volume cannot contain external
objects. Also protect calling recordings and certificates separately: the Convex
upgrade archive covers neither.

Cloud installs use a Convex export with file storage before upgrading. The export
uses the old migrate image and aborts the upgrade on failure. It is not a raw
whole-volume backup; check the pinned CLI's component export/import coverage,
including auth, and keep the provider's own backups. Scripted calling currently
requires local Convex: Cloud Node actions cannot reach the private gateway without
a separately secured public HTTPS proxy. See the
[manual gateway guide](calling-gateway.md#configuration-and-operation).

### Enable calling later

Prepare the calling DNS name, certificate and firewall, then re-run install:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- install --dir ./opensend \
  --calling yes --calling-domain calling.example.com \
  --calling-public-ip 203.0.113.10 \
  --calling-cert-dir /srv/opensend-calling-certs --yes
```

This keeps the saved release, accounts and secrets, backs up existing Convex data,
and adds the `calling` profile alongside existing profiles such as `smtp`. Calling
and TURN opt-ins are retained on later runs, including upgrades. `--calling no`
or `--turn no` does not turn off an already enabled profile. For a temporary
shutdown, stop the media services explicitly. For a permanent change, stop them,
edit the saved profiles and `OPENSEND_CALLING` / `OPENSEND_TURN`, and remove the
calling backend settings with the migrate CLI; do not remove data volumes.

Enable WhatsApp calling for the connected number in its channel settings, using
Graph signaling with Meta SIP mode disabled. Finish agent routing or bot setup
before a real call. See [browser deployment](browser-softphone.md) and
[calling gateway](calling-gateway.md) for team queues and routing. A trusted WSS
endpoint alone does not give agents access; the backend issues short-lived
credentials to authorized team members.

### Meta app setup

The installation administrator configures one Meta app for the installation;
teams connect their own accounts afterward. Follow the setup links in the
**Meta app** screen for Meta's current product names, review requirements and
business verification. The screen covers creating a Business app, adding WhatsApp,
Facebook Login for Business, Messenger and Instagram, and Tech Provider onboarding.

Add the dashboard domain to the app's allowed domains. Enter the app ID and secret,
plus the WhatsApp Embedded Signup and Facebook Login configuration IDs for the
channels you use. Save, **Verify**, then **Subscribe webhooks**. Copy the callback
URL and verify token displayed by Opensend when Meta asks for them. The public
callback must pass the wizard's check; it is served by the API origin, not the
realtime origin. Connect accounts from a team's Channels screen and verify the
necessary permissions, account ownership and app access before testing delivery.
Development-mode access is limited by Meta; installing the containers does not
grant production access. See [Meta setup](../components/dashboard/settings-meta.tsx)
for the exact links shown by this version.

### Troubleshooting v2

- **Image not found:** use a published release tag. The workflow builds all nine
  Opensend images for amd64 and arm64; a workflow edit does not publish them.
  Check `docker compose config --images` and `docker compose pull`. Saved image
  overrides keep their old values unless you replace them on upgrade.
- **Backup failed:** check free disk space, Docker access and the old migrate image.
  The script leaves the old configuration intact. Do not use `down -v` to retry.
- **Migrate failed:** read `docker compose logs migrate convex`. Check that the old
  instance name, instance secret and admin key remain together. Retry the same
  upgrade after fixing the error; backfills are resumable.
- **Meta callback fails:** check public DNS, HTTPS, proxy routing and the callback
  origin in the wizard. After changing it, verify and subscribe the app again.
- **Calling unavailable:** confirm `COMPOSE_PROFILES` includes `calling`, then read
  `docker compose logs call-gateway janus freeswitch voice-agent`. The migrate
  image must have supplied the gateway and WSS settings to Convex.
- **Browser WSS fails:** check DNS, TCP 7443 (or your saved WSS port), the certificate
  hostname/full chain, and UID 10002's access to `wss.pem`. The default localhost
  certificate is not trusted on a public hostname.
- **Call connects with no audio:** check public IPv4 advertisement and both UDP
  ranges in provider/Docker firewall rules. HTTPS working does not prove media
  works. For restrictive agent networks, enable TURN and check **Relay: on** in
  the microphone area. Verify the selected relay candidate in browser WebRTC
  diagnostics. Coturn denies private peers, so FreeSWITCH must advertise its
  reachable public RTP address.
- **Missing recordings:** FreeSWITCH stores WAVs in `calling-recordings`. The current
  Convex recording action requires `CALL_GATEWAY_RECORDINGS_DIR` on its Node
  action runtime, which this compose stack does not mount. Recording ingestion
  needs separate runtime wiring; keep recordings backed up and do not assume
  the installer uploads them. See [calling media](../convex/calling/media.ts).

## Install with the script

Install Docker with Docker Compose 2.24.4 or newer, then run:

```sh
curl -fsSL https://opensend.cc/install.sh | sh
```

Prompts read from the terminal even when the script is piped. With no terminal,
supply a hostname using flags or environment variables:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- install \
  --domain mail.example.com --api-domain api.mail.example.com \
  --realtime-domain realtime.mail.example.com --yes
```

The default directory is `./opensend`. The script downloads release Compose files
and the Caddyfile, writes `.env` with mode 0600, pulls prebuilt images and starts
the stack. No Node, pnpm or source checkout is needed on the server. Point the
three DNS hostnames at your server IP (the app, `api.` for the REST API and
callbacks, and `realtime.` for the dashboard's live updates) and allow ports 80 and 443. The first
account you create becomes the installation administrator. From the installation
directory, read its verification links with `docker compose run --rm migrate logs`.

Use `--dir PATH`, `--version TAG` to pin a release, `--caddy no` for an existing
HTTPS proxy, `--local` for localhost testing without Caddy, or `--no-start` to
prepare configuration. `--source-url URL` overrides the release asset base URL.
`help` lists the corresponding `OPENSEND_*`
environment variables. Image overrides (`APP_IMAGE`, `MIGRATE_IMAGE`, `SMTP_IMAGE`,
`CONVEX_IMAGE`), ports (`APP_PORT`, `CONVEX_PORT`, `CONVEX_SITE_PORT`) and
`COMPOSE_PROJECT_NAME` are saved in `.env`.

Re-running install preserves existing settings and secrets; opting into calling
adds missing settings. Replaced
Compose files get timestamped backups. Keep `.env` private and back it up along
with the persistent `convex-data` volume. Upgrade backs up `.env` and Convex data before setting the
release version and redeploying functions through the migrate container. If you use
image overrides, supply their new values when upgrading.

```sh
# Optional additional logical export; upgrade takes its own volume backup.
cd opensend
docker compose run --name opensend-backup migrate export --include-file-storage --path /tmp/backup.zip
docker cp opensend-backup:/tmp/backup.zip ./backup.zip
docker rm opensend-backup
cd ..

curl -fsSL https://opensend.cc/install.sh | sh -s -- upgrade --dir ./opensend
# Or pin the upgrade: ... | sh -s -- upgrade v0.1.0 --dir ./opensend
curl -fsSL https://opensend.cc/install.sh | sh -s -- uninstall --dir ./opensend
```

Uninstall stops the stack and keeps its volumes and configuration. Add `--purge`
to delete volumes; this always requires typing `PURGE` at a terminal, even with
`--yes`. The commands below use `.env.docker` for source installations; script
installations use `.env`, which Compose reads automatically.

## Convex Cloud

Choose Convex Cloud when you want no database to operate. Your data lives with
Convex, and its plan limits and costs apply. The dashboard and optional SMTP
service still run on your server, using the same images as the self-hosted stack.

Create a deployment and a deployment deploy key in Convex, then install:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- install \
  --convex cloud --domain mail.example.com
```

The installer prompts for the deploy key without echoing it. For unattended runs,
set `CONVEX_DEPLOY_KEY` and add `--yes` (or pass `--deploy-key`). The deployment URL
defaults to `https://<deployment-name>.convex.cloud`; `--convex-url` overrides it
for regional deployments. The HTTP site URL replaces `.convex.cloud` with
`.convex.site`; override it with `--convex-site-url` when needed. Both URLs also
accept `CONVEX_URL` and `CONVEX_SITE_URL` environment variables.

Only the dashboard hostname points at your server. API clients and SES callbacks
use the Convex Cloud API and HTTP site URLs directly; no API or hooks hostname
is required. `.env` stores `OPENSEND_CONVEX=cloud`, the deploy key, URLs and
`SES_CALLBACK_ORIGIN` with mode 0600. Upgrade and uninstall remember this mode.
The installer selects `compose.yaml:compose.cloud.yaml` and, when Caddy is enabled,
`compose.cloud-caddy.yaml`. Caddy serves the dashboard and custom tracking hosts,
forwarding `/t/*` over HTTPS with the upstream Host and the client's `X-Real-IP`.
Tracking resolves signed message tokens independently of Host. In cloud mode,
custom tracking CNAMEs point at the HTTPS dashboard hostname so requests reach
this proxy; fallback tracking links and SES callbacks still use the Convex site.
Without Caddy, configure your existing proxy to route custom tracking hosts in
the same way. A local HTTP dashboard does not support custom tracking hosts.

Back up data with Convex's own export, including file storage:

```sh
docker compose run --name opensend-backup migrate export --include-file-storage --path /tmp/backup.zip
docker cp opensend-backup:/tmp/backup.zip ./backup.zip
docker rm opensend-backup
```

`docker compose run --rm migrate logs` works the same in both modes. There is no
local database volume to back up in cloud mode. Keep `.env` private and backed up.

## From source

Install Docker with Compose, Node 22, and pnpm 11.7.0. Run:

```sh
pnpm install --frozen-lockfile
pnpm setup
```

The setup command generates `.env.docker` with mode 0600, generates the admin key using the pinned backend image, builds local images, and starts Convex and the application. A one-shot `migrate` container sets the backend environment and deploys functions before the application starts. Running setup again preserves secrets and the persistent volume. Keep `.env.docker` private and back it up. The Next.js container never receives the deployment admin key, Better Auth secret, or SSO encryption key.

Compose defaults to prebuilt `ghcr.io/panarastudios/opensend-*` images for the
app, migrate, SMTP and all six optional media services. Set `OPENSEND_VERSION`
to pin a release; the corresponding `*_IMAGE` variables override individual
images. Source setup saves local app/migrate image names in `.env.docker`, so
later Compose commands continue using your builds. Every Opensend service keeps
its `build:` definition. With a source checkout and prepared calling settings:

```sh
docker compose --env-file .env.docker --profile calling build janus freeswitch drachtio call-gateway voice-agent
docker compose --env-file .env.docker --profile calling up -d --no-build --pull never janus freeswitch drachtio call-gateway voice-agent
```

A release installation has no source files: use `--no-build` when managing it.
Building the native media images takes much more CPU, RAM and disk than running
them; use CI or a separate build host for a small VPS.

Open http://localhost:3000/signup. The first account claims instance setup atomically. Verify its email, sign in, and create a team. Subsequent accounts require a pending invitation matching their email. Deleting the first account does not reopen registration. A team invitation does not become a membership until the recipient accepts it.

The first account is the installation administrator: only it can change the AWS connection, regions and other instance-wide SES settings. Inside a team, every member manages the product (domains, keys, emails, audience); team admins also manage members, invitations, SSO and the team itself. To hand the installation administrator role to another verified account, run:

```sh
pnpm backend run installationAdmin:transfer '{"email":"new-admin@example.com"}'
```

Before an account sender is configured, only the installation’s first administrator receives account links through Convex function logs. Use the migrate container or the development helper below. Each bootstrap message is one JSON entry with recipient, subject, content, and actionLink; restrict log access. Other users need a sender configured in Amazon SES settings.

```sh
docker compose --env-file .env.docker run --rm migrate logs --history 50
# With Node and pnpm installed:
pnpm backend logs --history 50
```

The Convex dashboard is optional: start it with `docker compose --env-file .env.docker --profile debug up -d dashboard`, then open http://localhost:6791. It asks for the admin key in `.env.docker`. Treat dashboard access as administrative access to all stored data. Its port and both backend ports bind to loopback by default.

## URLs and production

Before the first setup, create `.env.docker` with your `SITE_URL`, `CONVEX_PUBLIC_URL`, and `CONVEX_PUBLIC_SITE_URL` overrides. Setup fills missing secrets without changing supplied values. Use HTTPS reverse proxies for all three public origins, including WebSocket forwarding for Convex. The app uses `http://convex:3210` and `http://convex:3211` internally. The browser receives only `CONVEX_PUBLIC_URL`, at request time. The same built app image can run under different hostnames.

The auth issuer is the public Convex HTTP origin. It must be reachable from Convex itself so it can retrieve its JWT signing keys. In Docker, public `localhost:3211` works only with the default backend HTTP port. For other local port mappings, use a hostname reachable from both the host and containers. Linux may require a `host.docker.internal:host-gateway` extra-host mapping for local OIDC tests.

The backend image is pinned by digest. No `NEXT_PUBLIC_*` hostname is baked into the app image. Do not publish the dashboard or backend administrative key. Set up TLS at your reverse proxy before using real accounts.

### HTTPS with the Caddy add-on

If your platform already terminates TLS (Dokploy, Coolify, or your own Traefik or nginx), route the three origins there and skip this. Otherwise, the optional `compose.caddy.yaml` adds [Caddy](https://caddyserver.com/docs/automatic-https), which gets and renews certificates automatically. Point DNS for the three hostnames at the server, open ports 80 and 443, set the three URLs in `.env.docker` to `https://`, and start the stack with both files:

```sh
docker compose -f compose.yaml -f compose.caddy.yaml --env-file .env.docker up -d
```

`docker/caddy/Caddyfile` routes `SITE_URL` to the dashboard, `CONVEX_PUBLIC_URL` to Convex (WebSockets included) and `CONVEX_PUBLIC_SITE_URL` to Convex HTTP actions, setting `X-Real-IP` for tracking. It also serves [custom tracking hosts](#tls-and-routing-for-custom-tracking-hosts) with on-demand certificates. With the add-on, the dashboard's port binds to loopback so Caddy is the only public entry point. The SMTP gateway terminates its own TLS and still reads its certificate from `SMTP_CERT_DIR`.

## Development

```sh
cp .env.example .env.local
docker compose --env-file .env.docker stop app
pnpm dev
pnpm backend dev --once
```

`pnpm backend` reads credentials from `.env.docker`, explicitly selects the self-hosted backend and never selects a cloud deployment. For plain `convex` commands (such as `convex codegen`, which editor and agent tooling run), set `CONVEX_SELF_HOSTED_URL` and `CONVEX_SELF_HOSTED_ADMIN_KEY` in `.env.local` as `.env.example` shows, following [Convex's self-hosting guide](https://docs.convex.dev/self-hosting). With both set, the CLI never creates or selects a cloud or Convex-managed deployment. Use `OPENSEND_ENV_FILE=/absolute/path/to/file` for another instance. `COMPOSE_PROJECT_NAME` selects an isolated Compose project; use different ports as well. Backend operations verify a live session and current membership; a valid but revoked JWT cannot authorize a request.

The local component is `convex/betterAuth`. `convex/authOptions.ts` supplies the shared configuration to the runtime, adapter and schema generator. Regenerate after changing plugin schema options:

```sh
cd convex/betterAuth
pnpm dlx auth@1.6.15 generate --config auth.ts --output generatedSchema.ts --yes
cd ../..
pnpm backend dev --once
```

Custom indexes and policy tables live in `schema.ts`, outside the generated file. Generic Better Auth organization endpoints are intentionally blocked. Opensend uses atomic component mutations for team administration so concurrent role changes and deletion cannot orphan a shared team. Account deletion requires a session created within the last five minutes. Password resets revoke existing sessions. Local MFA protects password sign-in; OIDC authentication relies on the identity provider's policies.

## Webhooks

Webhooks are signed exactly as Svix signs them (`svix-id`, `svix-timestamp`, `svix-signature`), so Resend's and Svix's verification libraries work unchanged. Signing secrets are encrypted with `SSO_ENCRYPTION_KEY`; changing that key makes existing secrets unreadable, so rotate every webhook's secret afterwards. Failed deliveries are retried on Svix's schedule (immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h), and an endpoint that has failed for five days is disabled. Rotating a secret replaces it at once: every attempt after that, retries included, is signed with the new secret only. Endpoints must be public HTTPS hosts: every address a host resolves to is checked before each attempt, and redirects are not followed. Deliveries and outbox events are kept for 90 days. As with Svix and Resend, delivery order is not guaranteed: events are delivered in parallel and a retried one arrives late, so `email.sent` can follow `email.delivered`. Order by the payload's `created_at`, and deduplicate by `svix-id`, which stays the same across retries and replays. A delivery that failed shows Pending while a retry is scheduled and Failed once none is left.

## Contacts and imports

CSV imports do not emit per-contact webhooks, including when an import merges into an existing contact. Ordinary contact creation and edits still emit events. Resend explicitly excludes CSV imports from [`contact.created`](https://resend.com/docs/webhooks/event-types); Opensend treats the entire import as a silent bulk operation.

Topic choices share one write helper across the dashboard (single and bulk), REST API, preference page and one-click unsubscribe. One operation emits one `contact.updated` per changed contact and advances `updated_at`; repeating the same choice emits nothing. Resend documents [contact updates](https://resend.com/docs/webhooks/contacts/updated) and [topic subscription updates](https://resend.com/docs/api-reference/contacts/update-contact-topics), but does not explicitly specify topic-only webhook behavior. Treating a topic change as a contact update is Opensend's consistency decision, rather than a separately verified Resend guarantee. Automation contact updates use the same audience helpers; the current automation builder has no topic-specific action.

## Unsubscribe links

Every recipient gets their own unsubscribe link. It carries the team, contact and (for a topic-scoped send) topic ids, never the address, and is signed with HMAC-SHA256 under `BETTER_AUTH_SECRET`. Links do not expire, so a link in an old email keeps working. Changing `BETTER_AUTH_SECRET` retires every link already sent.

`{{{OPENSEND_UNSUBSCRIBE_URL}}}` opens the preference page at `SITE_URL/unsubscribe/<token>`, where the contact manages the team's public topics or unsubscribes from everything. Private topics never appear there. Messages also carry `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 2369, RFC 8058), so mailbox providers show their own unsubscribe button. That button posts to `<callback origin>/unsubscribe/<token>` on the Convex HTTP origin configured during installation, which must be public HTTPS. The post leaves the link's topic, or everything when the link has none. Opening that URL with GET never unsubscribes (link scanners fetch it); it redirects to the preference page. Each contact is limited to 30 changes a minute. Every change fires `contact.updated`.

## OIDC

Each team can have one OIDC connection. An admin enters its issuer, client ID and client secret in Settings → SSO. Register the displayed callback URL with the identity provider. The secret is encrypted with `SSO_ENCRYPTION_KEY` and never returned by profile or team queries.

Click **Test connection** and complete a sign-in using an identity with a verified email. A successful callback for a team admin marks the connection tested. Only then can enforcement be enabled. The flow uses authorization code, PKCE, state, issuer validation and signed ID tokens. Providers must support the authorization response `iss` parameter. Existing users connect SSO while already signed in to their matching Opensend account; later SSO sign-ins use that link. New users require invitations. A team-configured IdP cannot claim an unrelated existing account merely by asserting its email. Provider links are bound to the configuration revision, so changing a connection requires linking again from a signed-in account. Email domains do not grant membership.

Enforcement is per team and session. Password sign-in still opens account settings and other teams. Changing the provider settings disables enforcement until another successful test, changes the revision and invalidates all previous proofs. Team operations are refused when the live session lacks a proof for the current configuration.

For a broken connection, an operator with the server admin key can disable enforcement:

```sh
pnpm backend run sso:recover '{"organizationId":"YOUR_TEAM_ID"}'
```

Recovery also invalidates the connection test and previous proofs. It does not reveal the client secret or grant membership.

The optional `oidc-test` Compose profile starts a disposable Keycloak realm:

```sh
docker compose --env-file .env.docker --profile oidc-test up -d oidc
pnpm backend env set ALLOW_LOCAL_OIDC=true
```

Use issuer `http://host.docker.internal:8080/realms/opensend`, client `opensend-test`, and secret `isolated-test-secret`. Test login: `oidc-owner` / `isolated-oidc-password`, verified email `owner@example.test`. The browser must also resolve `host.docker.internal`; use a local hostname mapping if necessary. This profile is only for isolated test accounts. Disable `ALLOW_LOCAL_OIDC` before real use. The realm permits callbacks on localhost ports 3000 and 3400.

## Logs and storage

### Outbound URL security

`lib/net/public-fetch.ts` is the shared Node transport for webhooks, OIDC discovery/token/JWKS requests, Domain Connect discovery/template/signing requests, SNS certificates and installation callback checks. It resolves once, rejects any non-public address in the answer, and pins the socket lookup to a validated address while retaining the original Host header and TLS server name/certificate checks. Each request uses a fresh connection, never follows redirects, and has bounded DNS/request time and response size. This follows Node's documented [custom lookup](https://nodejs.org/api/http.html#httprequesturl-options-callback) and [HTTPS request options](https://nodejs.org/api/https.html#httpsrequesturl-options-callback). URL (`path`) attachments remain disabled; adding them must use this transport too.

Local development exceptions are explicit and limited to an exact HTTP origin on `localhost`, `127.0.0.1` or `host.docker.internal`: installation-admin callback checks, OIDC with `ALLOW_LOCAL_OIDC=true`, and a fake Meta Graph API at `META_GRAPH_ORIGIN` (the e2e suite starts one; any other origin is ignored). They still pin the resolved address and never follow redirects; an IdP cannot extend the exception to another origin through discovery. Keep the flag disabled in production. SSO uses the installed Better Auth 1.6.15 `getToken` hook and JOSE custom JWKS fetch so neither library performs an unpinned request. Provider refresh tokens are not retained: SSO establishes an Opensend session and does not provide an IdP API-token refresh service.

### Team retirement

Deleting a team, leaving its last membership, or deleting its last member's account queues product-data erasure in bounded, indexed transactions. The eraser covers every `organizationId` table and unscoped child records, keeps aggregate counts synchronized, removes Convex-stored attachments/exports/avatars, and cancels automation workflows. Better Auth membership, invitations, SSO settings/proofs, grants and grant-linked tokens/consents are also erased in batches. Schema guard tests fail when a newly added team table has no retirement policy.

Access ends immediately. A `teamRetirements` record retains only the retired team ID and product-erasure completion time, preventing stale jobs or in-flight API requests from recreating product rows. AWS tenant removal retains its durable retry record until AWS confirms success; failed removal remains visible to the installation administrator for retry. Erasure requires sending domains to have been removed first. Existing installation-wide AWS/SNS resources and raw inbound objects in the shared S3 bucket are not deleted by this database eraser; their retention remains an operator responsibility. No IAM policy revision or permissions change is required.

### Account email sender

After verifying a sending domain and completing AWS setup, the installation
administrator can configure verification, password reset, change-email, invitation
and export notification emails in **Instance → SES → Account email sender**.
Choose a verified sending domain from any team, enter the from name and local
part, then Save. Clear restores the account-email console fallback. Only the
installation administrator can view or change these settings; team admins cannot.
The CLI remains available with the deployment admin key:

```sh
pnpm backend run installationAdmin:setSystemSender '{"from":"Opensend <no-reply@example.com>"}'
```

The dashboard and CLI share validation: both require a verified, sending-enabled
domain, a current IAM policy, and a ready SES tenant and region. Account mail uses that domain's team tenant
and configuration set through the same send queue. It lives under a separate
installation scope, is excluded from team lists, exports and webhooks, and loses
its body (including the one-time link) when sending settles. The SES mapping tags
still identify the actual sending team. Event processors must check `source`
before publishing any account-email event to a team's webhooks.

Clear the sender to restore the bootstrap console fallback:

```sh
pnpm backend run installationAdmin:setSystemSender '{}'
```

Without a configured sender, account links appear in Convex function logs only
when addressed to the first administrator recorded at bootstrap. Other account
mail is withheld with a readable setup error; its log contains no address or link.
For local development and the e2e suite only, `pnpm backend env set
LOG_AUTH_LINKS=true` logs every account's links while no sender is set (the e2e
stack sets it). Never set it on a real installation.
Better Auth preserves its generic password-reset response to avoid account
enumeration; team invitation mutations surface the setup error. With a sender configured, failures
log only the reason and never fall back to logging the secret link. The sender
must remain verified and enabled; changing or removing its domain can stop
account email.

```sh
docker compose --env-file .env.docker logs -f app convex
pnpm backend logs --history 100
```

Convex owns persistent database and file storage in the `convex-data` volume. `docker compose down` preserves it. `docker compose down -v` deletes it and is not a routine shutdown command. Bootstrap auth emails are Convex function logs, not Next.js logs. Function console output is redacted from ordinary clients by the backend container.

### Export notifications and bounded pickers

Following [Resend's export behavior](https://resend.com/changelog/exports-general-availability),
exports with more than 1,000 rows notify their creator by plain email when the
installation sender is configured. The link goes to
`SITE_URL/settings/exports/<id>`, never directly to file storage: team members can
view the details, and only team admins can download. Notifications are queued
once per export. Failed, expired and small exports send no notification. Without
a sender, no notification is sent or logged; the existing completion toast directs
the user to Settings → Exports. Files remain available for seven days from creation.

Dropdowns have no page controls. Custom properties use their existing team limit
(100). Segments have no team limit: segment pickers suggest the 20 newest or the
best name matches from the server, and always resolve the selected segment by id.
A contact's segments page on its detail screen. Contacts, custom events and domains offer up to 100
prefix matches; templates offer up to 100 search matches by name/alias. Search
reads the whole team's index, so older options remain reachable beyond the initial 100. The metrics chart's compact domain breakdown shows up to 100 domains in name
order; searching and selecting a domain reads that domain directly. Headline
metrics always cover the full selected scope. Tenant status badges use
sentence-case labels and the existing success/warning tones.

The Logs user-agent filter seeks distinct values in the team's retained log index,
independently of the loaded page or current filters. It offers the first 100 values
in lexical order; duplicate requests consume no extra slots. No separate backfill
job is needed, and options disappear when their last retained log is deleted.

## Recovering an account

An operator with the deployment admin key can recover an existing account even
when the account sender is unavailable:

```sh
pnpm backend run accountRecovery:resetPassword '{"email":"admin@example.com"}'
```

The command returns a one-time Better Auth password-reset link in CLI output
only; it neither emails nor logs the link. Open it to choose a new password within
one hour. It uses Better Auth's normal reset token, revokes existing sessions and
invalidates OAuth grants on reset. Unknown accounts fail without logging the
email address. Keep the returned link private. This does not bypass MFA or SSO.

## Background processing and retention

CSV imports enqueue durable jobs of up to 100 contacts each. Each transaction
processes at most 100 contacts and writes at most 200 segment memberships; a
contact's remaining memberships join in scheduled steps moments later (the same
applies to adding contacts to segments from the dashboard or the API). A request
names at most 1,000 segments. Rows with invalid contact fields are skipped.
Contact webhooks' `segment_ids` list at most 100 of the contact's segments, most
recently joined first: each event is one stored document, and bulk writes emit
one per contact. The existing dialog remains pending until
its jobs finish. Accepted jobs continue if the browser disconnects. Completed
job metadata is kept seven days; retrying a CSV merges contacts by email.

Exports encode each query page into a byte chunk and assemble the bounded chunks
for Convex file storage. The maximum is 200,000 rows and 16 MiB of UTF-8 CSV,
including headers. Exceeding either limit fails the export without publishing a
partial file and records a readable `error` on the export row. Narrow the date
range or filters and retry. The existing UI shows its unchanged failed state.
Metrics queries accept at most 31 daily buckets spanning 31 days (plus one hour
for DST), covering all existing date presets. Longer ranges are rejected.

Hourly, byte-bounded jobs prune raw SES events after 30 days; processed inbound
notifications are cleared immediately and deduplication rows expire seven days
after parsing. Unprocessed inbound messages remain available for retries.
Broadcast recipient/event histories expire 30 days after settlement. Totals are
snapshotted immediately before pruning, preserving delivery and engagement
updates received during the retention window, and the broadcast and totals remain
indefinitely. Automation workflow journals are cleaned on completion; finished
run/step histories expire after 30 days.

Auth cleanup removes pending OAuth flows after one hour, expired Better Auth
verification records (including pending SSO state), rate rows after their windows,
replay markers after their guarded token expires, and SSO proofs after the session
expires or is deleted. Legacy replay markers are checked against the original
token before removal. Expiry indexes on `oauthFlow`, `oauthRate`, and `oauthUse`
are staged for background backfill; this release deliberately uses bounded
creation-index scans until a later deployment promotes those indexes. The existing
Better Auth verification expiry index is reused, never duplicated.

## Backups and recovery

Keep an encrypted copy of `.env.docker`, especially the instance secret and SSO encryption key, with each backup. Restoring data without the same secrets can invalidate sessions or make OIDC secrets unreadable.

For a consistent whole-instance backup, stop writes and copy the volume while Convex is stopped:

1. Stop app and Convex: `docker compose --env-file .env.docker stop app convex`.
2. Use Docker's volume export/backup facility to archive this project's `convex-data` volume. Record the image digests and Git revision alongside it.
3. Restart: `docker compose --env-file .env.docker up -d --wait`.
4. Rehearse restoring the archive into a **new** Compose project and volume with different ports. Restore the saved environment file, adjust only the public URLs and ports, start the pinned backend, and verify users, organizations, memberships and avatar downloads before trusting the backup.

For data exports, `pnpm backend export --path backup.zip --include-file-storage` is also available. Check the CLI's component export/import options for the pinned Convex version: the auth tables are inside a component. A whole-volume backup avoids accidentally omitting component data. Never restore over the only working volume.

## Upgrades

Back up first. Pin the new image digests and compatible Better Auth/Convex versions on a branch. Regenerate the component schema and Convex types, run the checks below, and rehearse on a restored isolated volume. Apply schema additions compatibly before tightening validators. Re-run setup only after the rehearsal passes. Keep the previous images and backup for rollback; older binaries may not understand an upgraded database.

After deploying a version that adds row counts (the "Page 1 – 3 of 120 contacts" in list footers), count the rows written before it:

```sh
pnpm backend run migrations:backfillCounts
pnpm backend run --component migrations lib:getStatus --watch
```

The backfill runs in the background in batches and is safe to run again: it resumes where it stopped and never counts a row twice. Until it finishes, list totals and segment sizes can read low.

The substring-search fix needs no backfill: stored fields and indexes are unchanged. Reload open dashboard lists after deploying it so pagination starts with fresh cursors. Searches now scan bounded index pages and keep totals unknown until the range is exhausted; selective searches may take more requests. See [search pagination](search-pagination.md) for the engine limits, read budgets and regression coverage.

## Removing Opensend from AWS

`pnpm aws:cleanup` lists everything Opensend installations created in an AWS
account: SES tenants, domains, configuration sets and receipt rules, SNS topics,
the SQS dead-letter queue, inbound S3 buckets, the setup CloudFormation stack,
and the IAM user and policy. It matches Opensend's `opensend-<installation id>`
names and `opensend:installation` tags only, and changes nothing until you add
`--delete`. Use `--keep=<id>` to spare the installation you still run, or
`--only=<id>` to remove one. Run it with an administrator's credentials
(`AWS_PROFILE`, or the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment
variables), not Opensend's own key, which cannot see or delete most of this.
A domain Opensend adopted from an existing SES setup carries the same tag and is
deleted with the rest, so review the list first. DNS records at your DNS
provider are not touched.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:auth
pnpm build
```

The Playwright suite starts a fresh Docker project named `opensend-e2e-…`, with a separate Convex volume, the production app image, the migrate container and Keycloak. It allocates free host ports, leaves the main instance untouched and removes the test volume on completion.

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The HTML report is in `playwright-report/`. Failure traces, screenshots and test email logs are in `test-results/`; these directories are ignored by Git. Set `OPENSEND_KEEP_E2E=1` to preserve the test containers after a debugging run. The next run resets only that test project. The suite drives the UI and checks direct backend authorization, and also renders all existing dashboard sections under a real session.

`test:auth` covers bootstrap concurrency, invitation restrictions, cross-team access, role escalation, last-admin safety, deletion, revoked sessions and SSO proofs. The production API smoke script covers verification, password reset, email change, MFA/backup codes, invitations, avatars and deletion. Run it only against a fresh disposable deployment with `LOG_AUTH_LINKS=true`, since it reads other accounts' links from the logs:

```sh
pnpm backend logs --jsonl > /tmp/opensend-test-logs.jsonl
# In another terminal, pointing at that disposable instance:
OPENSEND_SMOKE=isolated-test-instance \
OPENSEND_TEST_URL=http://localhost:3400 \
OPENSEND_TEST_BACKEND=http://localhost:3210 \
OPENSEND_TEST_LOG=/tmp/opensend-test-logs.jsonl \
node scripts/auth-smoke.mjs
```

The smoke script creates `owner@example.test`; use fresh isolated volumes for a full rerun. Never run it against a real instance. Keep the main local instance uninitialized until its actual owner signs up.

## Optional SMTP submission service

The `smtp` Compose profile runs a separate Node process. It accepts authenticated
submission on **465 (implicit TLS)** and **587 (STARTTLS required before AUTH)**.
Username is `opensend`; password is an Opensend `os_` API key with sending or full
access. The TLS modes match [Resend's](https://resend.com/docs/send-with-smtp); a
client moving from Resend changes its host, username and password.
Sending-domain restrictions on keys apply. Each team starts disabled; any member
can enable SMTP in **Settings → SMTP**. The port selector remembers that team's
preferred connection port; both listeners stay available to enabled teams.

1. Point an unproxied DNS A/AAAA record (for example `smtp.example.com`) to the
   host. Open inbound TCP 465 and 587. This is a submission service, so no MX
   record or inbound port 25 is needed. Keep your SES domain's DKIM, MAIL FROM
   and SPF records configured; SES performs final delivery.
2. Obtain a trusted TLS certificate for that hostname. Put `fullchain.pem` and
   `privkey.pem` in a dedicated directory readable by container UID 1000. Keep
   the private key restricted. If using Let's Encrypt symlinks, copy the resolved
   files into this directory. It is mounted read-only. Restart the SMTP service
   after certificate renewal; certificates are loaded at startup.
3. Set `SMTP_HOST=smtp.example.com` and `SMTP_CERT_DIR=/absolute/certificate/directory`
   in `.env.docker` and run `pnpm setup` to push **SMTP_HOST** to the Convex
   deployment environment so the existing settings tab displays it. It is an
   installation setting, never a team-editable hostname. When unset or blank in
   Convex, the dashboard uses the hostname of `SITE_URL` (without protocol, port,
   or path). This fallback only supplies the displayed connection host; the SMTP
   gateway still requires its hostname and a matching TLS certificate.
4. After deploying backend code, start the opt-in profile:

   ```sh
   docker compose --env-file .env.docker --profile smtp up -d --build smtp
   ```

The process fails to start without a hostname, key or certificate. Docker maps
public 465/587 to unprivileged container ports 2465/2587; `SMTP_TLS_PUBLIC_PORT`
and `SMTP_STARTTLS_PUBLIC_PORT` can override the host mappings. For running
without Docker, use `node docker/smtp/main.mjs` with `SMTP_HOST`,
`SMTP_CONVEX_SITE_URL`, `SMTP_TLS_KEY_PATH`, and `SMTP_TLS_CERT_PATH`.
`SMTP_TLS_PORT`/`SMTP_STARTTLS_PORT` default to 2465/2587 inside the process.
The Convex site URL is its HTTP-action endpoint (3211), not its query endpoint
(3210). Use HTTPS when the gateway and Convex are not on a private network.
There is no deployment admin key or AWS credential in the gateway.

Messages are parsed into the same sending pipeline as REST: verified sender,
key domain restriction, team SES tenant/configuration set, suppression checks,
attachments, durable queue and provider retries. SMTP envelope recipients are
honored; recipients absent from To/Cc are Bcc. Body parts, Reply-To, inline
attachments and custom headers are retained; transport/MIME headers are rebuilt.
A Bcc-only envelope is supported. `Opensend-Idempotency-Key` becomes the existing
24-hour HTTP idempotency key. Supply it when retrying an uncertain submission.
No undocumented SMTP tags header is interpreted; use the REST `tags` field when
message tags are required.

The maximum MIME DATA size is 40 MiB (including encoded attachments), matching
[SES v2's message limit](https://docs.aws.amazon.com/ses/latest/dg/attachments.html).
`SMTP_MAX_MESSAGE_BYTES` may lower, but never raise, it. Existing REST/Convex
limits also apply: 50 recipients, 900,000 bytes of body plus custom headers,
42 MiB of mapped JSON, and any deployment/proxy HTTP body cap. SES also enforces its final encoded message limit. Oversized DATA
is drained without retaining excess bytes. At most 16 clients connect per listener.

AUTH and submissions share REST's team-wide 10 requests/second limit across all
keys. A successful AUTH consumes one request; reuse an authenticated connection
for multiple messages. Disabling SMTP or revoking a key also rejects subsequent
messages on an already authenticated connection. `250 Queued as …` means the
message is durably queued, not delivered. Rate limiting and backend outages
return temporary SMTP errors; invalid credentials or messages return permanent
errors. Inspect Emails and API Logs (`source: smtp`, `/smtp/auth` and
`/smtp/emails`) for attributable requests. Resend documents emails in its email
list but does not provide SMTP server debug logs; Opensend's API logs expose the
submission bridge, not the SMTP wire conversation. Credentials are redacted and
the gateway never logs AUTH or message content.

## Opensend tracking

Opensend rewrites HTML links and serves its own open pixel; SES only sends the
message. There is no CloudFront, ACM, or SES open/click tracking dependency. In the
existing domain Configure dialog, turn on open and/or click tracking. The Tracking
CNAME now points at the hostname of `installation.callbackOrigin`, the public
HTTPS Convex HTTP origin already confirmed through SNS. Publish that CNAME and
verify the domain. Until the CNAME verifies, mail uses the installation origin.
An otherwise send-ready domain can send while only its tracking CNAME is pending.

HTML `a`/`area` HTTP(S) links are tracked. Plain text, `mailto:`, fragments,
unsubscribe routes, URLs in `List-Unsubscribe`, `rel="unsubscribe"`, and
`ses:no-track` links are left alone. The parser preserves other markup and
attributes. Resend documents [HTML rewriting and a transparent GIF](https://resend.com/docs/dashboard/domains/tracking);
its documentation does not specify a per-link opt-out or plain-text click
rewriting. Opensend leaves plain text unchanged and additionally honors AWS's
[documented `ses:no-track` attribute](https://docs.aws.amazon.com/ses/latest/dg/faqs-metrics.html)
for compatibility.

Tracking tokens use the same HMAC implementation and `BETTER_AUTH_SECRET` as
unsubscribe links, with a separate signing context. Tokens contain only email ID
and link index. Redirects resolve from a private per-email URL map, never a URL
supplied by the HTTP request. Each message is capped at 1,000 tracked links and
128 KiB of destination URLs; exceeding either fails the send before SES is called.
System account mail is not tracked. Tracking maps expire with the existing
30-day email content retention, after which these endpoints return 404. Rotating
the signing secret also invalidates previously sent links.

Every accepted GET hit adds one event, including repeat opens/clicks, following
Resend's [event-per-occurrence model](https://resend.com/blog/webhooks). The shared
projection keeps unique email milestone metrics, status precedence and webhook
outbox writes atomic. Click payloads follow
[Resend's click fields](https://resend.com/docs/webhooks/emails/clicked); open
payloads use its [message fields](https://resend.com/docs/webhooks/emails/opened).
Multi-recipient messages share a token and are measured at message level.
Prefetching/scanning clients can produce events. Both endpoints disable caching
and limit each email to 120 hits/minute (excess hits return 429 without an event).

### TLS and routing for custom tracking hosts

A CNAME alone does not configure TLS or route the request. Custom tracking hosts
must terminate HTTPS on your infrastructure and forward `/t/*` to the **Convex
HTTP site on port 3211**, not the Next.js dashboard or Convex API port 3210. Also
serve `/t/*` on the installation callback origin for fallback links. Preserve the
path and query, disable caching, and overwrite `X-Real-IP` with the client IP;
Opensend uses that trusted proxy header in click webhooks.

The [Caddy add-on](#https-with-the-caddy-add-on) already does this. For your own
Caddy, restrict [on-demand TLS](https://caddyserver.com/docs/automatic-https#on-demand-tls)
with the provided ask endpoint. For example, merge these rules into your existing
Caddyfile (replace the host and internal upstream with your deployment's values):

```caddyfile
{
    on_demand_tls {
        ask http://convex:3211/t/ask
    }
}

api.opensend.example {
    reverse_proxy convex:3211 {
        header_up X-Real-IP {remote_host}
    }
}

https:// {
    tls {
        on_demand
    }
    handle /t/* {
        reverse_proxy convex:3211 {
            header_up X-Real-IP {remote_host}
        }
    }
    handle {
        respond 404
    }
}
```

Caddy supplies `?domain=<hostname>` to `/t/ask`. It returns 200 only for a current,
verified tracking CNAME belonging to a live domain with tracking enabled and
pointing to this installation; other names return 403. DNS verification happens
before Caddy requests the certificate. Ports 80/443 must reach Caddy and the
hostname's CAA policy must allow its configured issuer. Configure TLS and routing
before verifying the CNAME, since verification immediately enables that hostname
for new sends. Keep old hostname proxy/certificate configuration explicitly if
you change a tracking subdomain: the ask allowlist covers current names only.

With Cloudflare Tunnel, add the tracking hostname as another published hostname
(or ingress `hostname` entry), forwarding to `http://convex:3211`, and provision
Cloudflare edge TLS for that hostname. Merely pointing DNS at the installation
hostname does not add an ingress rule. Follow Cloudflare's
[tunnel DNS routing](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/)
instructions. Verify the required installation-host CNAME while it is DNS-only;
Cloudflare proxying/flattening hides CNAME answers, and a later Opensend DNS check
can mark it pending and return new sends to the installation origin. If you use
the tunnel's UUID CNAME directly instead, that is not the installation-host CNAME
Opensend verifies; use the fallback origin or a DNS-visible proxy setup for
persistent custom-host verification. Have a trusted proxy overwrite `X-Real-IP`
from Cloudflare's authenticated client-IP header, rather than accepting a header
from an arbitrary public client.

When upgrading from SES tracking, refresh each domain to replace its event
destination and Tracking DNS target, then verify the new CNAME. Do this before
sending tracked mail, to prevent old SES configuration from wrapping links a
second time. SES `OPEN`/`CLICK` notifications are no longer projected.
IAM policy revision 3 no longer grants `ses:PutConfigurationSetTrackingOptions`.

## Receiving: transient S3 drop box

SES receives into the existing regional bucket under `<domainId>/<sesMessageId>`
and sends a signed SNS notification containing the object location. S3 remains
necessary: the [SNS body action](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-sns.html)
bounces messages above 150 KB, whereas the
[S3 action](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html)
supports a default maximum of 40 MB including headers. Opensend does not use the
SNS body action and does not silently truncate mail.

A dedicated Convex workpool immediately downloads each accepted notification's
object with `ExpectedBucketOwner`, bounds both declared and streamed size to
40 MiB (41,943,040 bytes), stores the MIME file in Convex file storage, commits its
`storageId`/`size`/`storedAt` on `inboundMessages`, then deletes the S3 object.
SES enforces its own size limit before delivery; the application cap is an
additional ingestion limit. Over-cap objects are marked `rejected` with
`transferError`, never parsed, and left for lifecycle expiration. This happens
after SES acceptance and does not generate a new SMTP bounce.

SNS message IDs and bucket/object keys deduplicate deliveries. Failed transfers
retry up to 12 attempts with exponential backoff starting at one second (about
34 minutes of backoff total). A delete failure retries only deletion once the
storage ID is committed. Failures leave the source object available for retry.
Exhausted jobs retain `transferError`; an operator can replay
`ses/inboundMessages:retry` with `{ "id": "<inboundMessages id>" }` before S3
expiration. A repeated SNS delivery can also requeue an exhausted transfer.

Bucket provisioning installs an enabled `opensend-transient-inbound` lifecycle
rule with `Expiration.Days: 1`, retaining unrelated rules. This is a recovery
ceiling, not an exact 24-hour deletion timer: S3 expiration is asynchronous and
[day calculations round to midnight UTC](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html).
Normal delivery removes objects immediately after storage. Re-provision existing
inbound regions to install the rule. Keep these dedicated drop-box buckets
unversioned; object version retention is not managed by this rule. There is no
bucket reconciler for notifications that never arrive, so monitor SNS delivery
failures and `transferError` before the recovery window closes.

Wave 5B starts from `inboundMessages.storageId` (even if S3 deletion is still being
retried), reading raw `message/rfc822` from Convex storage. MIME parsing, the
Receiving list, received-email webhooks, and durable received-mail retention are
left for that wave. Back up Convex file storage with the database; S3 is not the
mail archive.
