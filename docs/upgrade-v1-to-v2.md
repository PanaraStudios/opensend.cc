# Upgrade opensend.cc from v1 to v2

Use `v2.0.0` for the commands below. Keep your existing installation directory,
Compose project name, backend mode and secrets. Plan a maintenance window.
Read the [release notes](releases/v2.0.0.md#breaking-or-behaviour-changes) before
updating API clients.

## 1. Save configuration and back up data

Pause incoming API and webhook traffic at your proxy. Let queued sends and active
calls finish. Stop new broadcasts and automation triggers. Stopping an automation
does not cancel runs already in progress; let those finish too.

Run from the existing installation directory. Script installs use `.env`.
Source installs normally use `.env.docker`. Select the file you already use:

```sh
OPENSEND_ENV_FILE=.env
# For a source install instead:
# OPENSEND_ENV_FILE=.env.docker

dc() { docker compose --env-file "$OPENSEND_ENV_FILE" "$@"; }
OPENSEND_BACKUP_DIR="$(pwd)/backup-v1-$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$OPENSEND_BACKUP_DIR"
tar -czf "$OPENSEND_BACKUP_DIR/config.tgz" \
  "$OPENSEND_ENV_FILE" compose*.yaml docker/caddy
dc config --images > "$OPENSEND_BACKUP_DIR/images.txt"
dc images > "$OPENSEND_BACKUP_DIR/running-images.txt"
dc run --name opensend-v1-backup migrate export \
  --include-file-storage --path /tmp/data.zip
docker cp opensend-v1-backup:/tmp/data.zip "$OPENSEND_BACKUP_DIR/data.zip"
docker rm opensend-v1-backup
```

Keep the one-off container until the copy succeeds. Check that the archive is
readable and contains your tables, component data and file storage. Copy the
backup off the server. Also save custom proxy configuration, TLS certificates,
Compose overrides and the source revision if you build locally.
Record the running image IDs or immutable digests and keep the old images
available. A saved `latest` tag can point at a different image after an upgrade.

Preserve `INSTANCE_NAME`, `INSTANCE_SECRET`, `CONVEX_SELF_HOSTED_ADMIN_KEY`,
`BETTER_AUTH_SECRET`, `SSO_ENCRYPTION_KEY` and any legacy `SES_ENCRYPTION_KEY`.
For Convex Cloud, preserve the deploy key and deployment URLs instead of local
backend credentials. Keep separately configured backend storage credentials too.
The data archive does not replace a backup of backend environment settings.

For self-hosted Convex, also take a stopped-volume snapshot with your host's
backup tool. Stop Convex for that snapshot and start it afterwards. Keep the
`convex-data` volume and any external storage buckets. In Convex Cloud there is
no local database volume; use the same export command and your cloud backup
facilities. Do not use `docker compose down -v` during an upgrade.

The installer only saves timestamped copies of configuration and prints an
export reminder. It does not take a database backup or wait for one.

## 2. Upgrade the installation

Choose the path matching your existing install. Keep the original proxy,
storage and cloud overrides selected. `COMPOSE_FILE` in your environment file
can record them. For source installations without it, add the same `-f` options
to the `dc` function for every command below.

### Script install

From the parent directory of your installation:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- \
  upgrade v2.0.0 --dir ./opensend
```

Use your actual installation path. The script remembers self-hosted or cloud
mode, keeps secrets, downloads the release Compose files, updates
`OPENSEND_VERSION`, pulls images and recreates the migration container.

If `.env` has `APP_IMAGE`, `MIGRATE_IMAGE` or `SMTP_IMAGE`, those values override
the version. Supply matching images explicitly:

```sh
curl -fsSL https://opensend.cc/install.sh | \
  APP_IMAGE=ghcr.io/panarastudios/opensend-app:v2.0.0 \
  MIGRATE_IMAGE=ghcr.io/panarastudios/opensend-migrate:v2.0.0 \
  SMTP_IMAGE=ghcr.io/panarastudios/opensend-smtp:v2.0.0 \
  sh -s -- upgrade v2.0.0 --dir ./opensend
```

Return to the installation directory and recreate the `dc` function from step 1
if you opened a new shell. Reapply any edits you made directly to downloaded
Compose files. Keep custom changes in overrides for future upgrades. If SMTP
is enabled, also update it with `dc --profile smtp up -d --wait --no-build smtp`.

### Compose install with release images

Download the `v2.0.0` Compose and Caddy assets from the
[GitHub release](https://github.com/PanaraStudios/opensend.cc/releases/tag/v2.0.0)
into the installation directory. Keep the old assets in the backup.

Set `OPENSEND_VERSION=v2.0.0` in your private environment file. Remove individual
app, migration and SMTP image overrides, or change them to the matching release
images. Keep the backend image pin from the release Compose file unless you
already manage that pin yourself. Then run:

```sh
dc pull convex migrate app
dc rm -f migrate
dc up -d --wait --no-build
dc ps -a
dc logs --tail=100 migrate app
```

For Convex Cloud, use the existing cloud overrides and run `dc pull migrate app`
instead; there is no local `convex` service. If using SMTP, also run
`dc --profile smtp pull smtp` and
`dc --profile smtp up -d --wait --no-build smtp`.

### Compose install built from source

Save your old source revision, then check out the `v2.0.0` release in that
installation's source checkout. Install its locked dependencies and rebuild
the local images:

```sh
git fetch origin tag v2.0.0
git switch --detach v2.0.0
pnpm install --frozen-lockfile
OPENSEND_ENV_FILE="$OPENSEND_ENV_FILE" pnpm setup
```

Use the Node and pnpm versions listed in [self-hosting](self-hosting.md#from-source).
`pnpm setup` normally uses `.env.docker`; the command above keeps your selected
environment file. It preserves secrets and data, rebuilds the app
and migration images, and redeploys the backend. Rebuild an enabled local SMTP
image separately with `dc --profile smtp build smtp`, then recreate it.
If you use a custom Compose file selection, carry it into this setup too.

## 3. Check the migration step

The one-shot `migrate` service waits for a self-hosted backend, sets supported
nonempty backend environment values and deploys functions, components, schema
and indexes. In cloud mode it deploys using your saved deploy key. The app waits
for this service to succeed. Check that it exited with code `0` in `dc ps -a`.
New search indexes can make this step take longer on a large database.

This step does not import a backup, move files to S3, configure calling or run
the historical count backfill. Existing v1 data remains in place. If an older
installation lacks historical counts or reports, the separate resumable runner is:

```sh
dc run --rm migrate run migrations:backfillCounts
```

It rebuilds counts and email metrics, projects stored SES events, rebuilds
broadcast reports, queues parsing for unparsed stored inbound mail and removes
replaced counter fields. It records progress; rerunning resumes or skips completed
work. Monitor it with `dc run --rm migrate logs`. It does not repair historical
call timestamps or recover object-only files from an earlier v2 storage provider.

## 4. Enable calling, if needed

Email and Meta messaging do not need the calling services. To enable WhatsApp
Calling, use a checkout of the same release with the `docker/` and `services/`
build sources. The standard release publishes prebuilt app, migration and SMTP
images; it does not publish the calling images. A script-only installation must
add those sources and build the calling services from the matching release.
Keep the same environment, project name and Compose file selection.
Keep the existing `dc` function for backend commands. If the source checkout is
elsewhere, use a separate function for the calling build, with absolute paths:

```sh
OPENSEND_INSTALL_DIR="$(pwd)"
OPENSEND_SOURCE_DIR=/absolute/path/to/v2-source
calling_dc() {
  docker compose --env-file "$OPENSEND_INSTALL_DIR/$OPENSEND_ENV_FILE" \
    -f "$OPENSEND_SOURCE_DIR/compose.yaml" "$@"
}
```

Set `COMPOSE_PROJECT_NAME` to your existing project's name in the selected
environment file. This keeps the calling services on the installation's network.
Include any calling-specific overrides with extra `-f` options in this function.
For a source install in the same directory, `calling_dc() { dc "$@"; }` is enough.

Add each secret below to your private environment file, generating a different
value with `openssl rand -hex 32`:

```dotenv
CALL_GATEWAY_SECRET=<gateway secret>
JANUS_API_SECRET=<Janus secret>
FREESWITCH_ESL_SECRET=<control secret>
FREESWITCH_SIP_SECRET=<SIP secret>
FREESWITCH_DIRECTORY_SECRET=<directory secret>
DRACHTIO_SECRET=<drachtio secret>
VOICE_AGENT_SECRET=<voice agent secret>
CALL_GATEWAY_CONVEX_HTTP_URL=http://convex:3211
JANUS_PUBLIC_IP=<server public IPv4>
FREESWITCH_PUBLIC_IP=<server public IPv4>
FREESWITCH_CERT_DIR=/absolute/path/to/calling-certs
```

Use your Convex HTTPS site URL for `CALL_GATEWAY_CONVEX_HTTP_URL` in cloud mode.
The certificate directory needs `wss.pem`: private key followed by the full
certificate chain for your calling hostname, readable by container UID 10002.
The default self-signed certificate is for local development.

Open and forward these ports, preserving the UDP port numbers:

| Ports                            | Purpose                                |
| -------------------------------- | -------------------------------------- |
| UDP 20000–20199                  | WhatsApp call media                    |
| UDP 20400–20799                  | Browser agent media                    |
| TCP 7443                         | Browser calling over secure WebSockets |
| UDP/TCP 3478 and UDP 20800–20999 | Optional agent TURN relay              |

Keep SIP and control ports private. Leave the gateway's host port `8090` bound
to loopback. For a server behind NAT, set both public IP values and forward the
media ranges one to one. STUN alone does not fix blocked UDP.

With the matching source files selected:

```sh
calling_dc --profile calling build janus freeswitch drachtio call-gateway voice-agent
calling_dc --profile calling up -d --wait janus freeswitch drachtio call-gateway voice-agent
curl --fail http://127.0.0.1:8090/healthz
```

Set `CALL_GATEWAY_URL`, the same `CALL_GATEWAY_SECRET` and `CALL_AGENT_WSS_URL`
on the backend with `dc run --rm migrate env set NAME=value`. For self-hosted
Compose, the gateway URL is `http://call-gateway:8090`; the agent URL is
`wss://calling.example.com:7443`. Keep secrets out of shared terminal history.
These values are not passed to the backend by the standard migration service.
Cloud actions need a secured HTTPS route to the gateway; never expose its private
agent directory endpoint through that route.

Choose a number's calling mode and routing in Channels. Add AI keys in Settings →
AI providers, render IVR prompts and test a bot or menu before assigning it.
Outbound calls also need the recipient's permission and Meta calling eligibility.

For agents on strict networks, set `CALL_TURN_PUBLIC_IP` and a separate
`CALL_TURN_PASSWORD`, then build and start `coturn` with the `calling-turn`
profile. Starting it alone does not enable relay use in the dashboard. You must
configure the browser adapter's `iceServers` and deliver credentials securely.
The bundled relay supports TURN on `3478`, not TLS TURN on `5349`. It only serves
the agent side. See [gateway setup](calling-gateway.md#optional-agent-turn) and
[browser calling](browser-softphone.md#operator-configuration-required-before-browser-media-works)
for certificates, queues and adapter details.

```sh
calling_dc --profile calling --profile calling-turn build coturn
calling_dc --profile calling --profile calling-turn up -d --wait coturn
```

## 5. Set up the Meta app, if needed

As the installation administrator, open the account menu → Meta app
(`/instance/meta`). Add your Business app ID and secret, verify the app and
subscribe its webhooks. Use the callback URL and verify token shown there;
the callback ends in `/meta/webhook` on the API origin.

Follow that page's setup links for
[creating an app](https://developers.facebook.com/docs/development/create-an-app/),
[App Review](https://developers.facebook.com/docs/app-review),
[Tech Provider onboarding](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers)
and [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/implementation).
Add WhatsApp, Facebook Login for Business, Messenger and Instagram as needed.
Complete business verification and the required permission review for your use.
Until App Review passes, connections are limited to businesses in your own portfolio.

For Embedded Signup, save the WhatsApp configuration ID and allow your dashboard
domain in the app. Page connections use a separate Facebook Login configuration
ID. Manual token connections are also available. Teams then connect senders in
Channels. WhatsApp numbers must be registered; templates need Meta approval.
Test with real accounts before enabling production sends or calls.

## 6. Check telemetry settings

The shipped app image sets `NEXT_TELEMETRY_DISABLED=1`. The self-hosted Convex
service sets `DISABLE_BEACON: "true"` in Compose. Keep those switches in custom
images and Compose files if you want framework telemetry disabled. For local
source commands, set `NEXT_TELEMETRY_DISABLED=1` in the shell as well.

These are framework switches. They do not disable your own call transcripts,
usage records or logs. There is no separate opensend.cc telemetry switch in this
release. Convex Cloud's service settings are managed outside this Compose stack.

## 7. Verify before reopening traffic

- Check `dc ps -a` and the migration logs. The app and backend should be healthy,
  and the migration container should have exited successfully.
- Sign in with an existing account. Check its team, domains, contacts, templates,
  automations and broadcast history. Open an old email and download an old file.
- Send a test email through your existing `/emails` integration. Check receipt,
  delivery status and your signed customer webhook.
- Check nullable contact emails, mixed-channel lists and permission errors in
  your client. If adopting `/messages`, follow `next_cursor` through every page.
- Try a Custom key on its allowed resource, then on one it cannot read or write.
  Confirm the latter returns `403`. Revoke the test key afterwards.
- If Meta is enabled, send and receive one real message on each connected channel.
  Check template approval and conversation windows.
- If calling is enabled, test inbound audio, keypad input, agent handoff and a bot
  call. Check an outbound call after granting permission. Read its transcript and
  recording if enabled. Test an agent from the networks your team actually uses.

Use the [live checklist](qa/live-checklist.md) for the full real-provider check.
Reopen traffic and restart intended automation triggers after verification.

## 8. Roll back from the backup

A rollback restores the backup's point in time. Later sends cannot be unsent,
and later database changes will be lost. Pause external traffic again and let
active jobs and calls finish. Keep a separate v2 export if you need to retain
those later records for review.

While the v2 backend and migration image are still available, stop the app and
any enabled SMTP or calling services. Restore the v1 data into the backend before
deploying the old schema. Use the absolute backup directory from step 1:

```sh
dc stop app
# Stop SMTP and calling services too if you enabled them.
dc run --rm -v "$OPENSEND_BACKUP_DIR:/backup:ro" migrate \
  import --replace-all --yes /backup/data.zip
dc down
tar -xzf "$OPENSEND_BACKUP_DIR/config.tgz"
```

`--replace-all` replaces deployment data, including tables absent from the
backup. Use it only on the installation being restored. Keep the backup and
encryption keys together. The import restores Convex-managed file bytes; recover
any separately stored files from their own backup.

For release-image installs, pull the saved v1 images. For source installs, return
to the saved v1 revision and rebuild its images using the restored environment.
The original Compose project name must stay the same so it finds the same volume.
If the saved configuration used `latest`, replace it with the v1 image digests or
IDs recorded in step 1 before starting. Do not resolve `latest` again for rollback.

```sh
dc pull convex migrate app
dc rm -f migrate
dc up -d --wait --no-build
dc ps -a
dc logs --tail=100 migrate app
```

Skip `convex` in cloud mode. Restart the old SMTP image separately if enabled.
For local source images, use the v1 source setup command instead of pulling them.
If the backend or import cannot be recovered, stop the stack and restore the cold
volume snapshot and matching configuration with your host's backup tool. Leave
the failed volume intact until the restored instance has been verified.

Repeat the existing-account, old-file and test-email checks before reopening
traffic. Restore backend environment settings from your saved configuration too;
a data import does not restore them. Remove v2-only calling backend settings if
they were added during the upgrade.
