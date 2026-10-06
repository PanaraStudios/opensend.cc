# Upgrade opensend.cc from v1 to v2

Use `v2.0.0` for the commands below. Keep your existing installation directory,
Compose project name, backend mode and secrets. Plan a maintenance window.
Read the [release notes](releases/v2.0.0.md#breaking-or-behaviour-changes) before
updating API clients.

## What changes when you upgrade

**Anonymous usage statistics are on by default**, including on an existing
installation without a saved preference. Turn sharing off in the setup wizard
or **Instance → Amazon SES**, pass `--telemetry no` to the installer, or set
`OPENSEND_TELEMETRY=0` in the Convex backend for a locked hard off. To prevent
sharing from the first v2 start, use the installer flag or set the environment
value before running migration.

Schema 1 sends a random persistent installation ID, timestamp, version,
installation age in whole days, backend type, install method, architecture and
a calling-enabled flag. Script installs can report that flag as false even when
calling is enabled; the backend flag recognizes `1`, while the installer saves
`yes`. Usage counts are bands: `0`, `1-9`, `10-99`, `100-999`, `1k-9k` or `10k+`. They cover teams, memberships, verified domains,
active automations, webhook endpoints, API keys, connected WhatsApp numbers,
Messenger Pages, Instagram accounts, IVRs and voice bots. They also cover sent
and received emails, API/SDK/MCP requests and channel messages over the latest
complete 24 hours, plus broadcasts and calls created over 30 days. Test calls
are included. Booleans indicate SES production access (`null` if unknown),
SMTP use over 30 days and enforced SSO.

The payload never includes email addresses, names, domains, hostnames, IP
addresses, team or user IDs, message content, keys or URLs. Exact feature counts
are never sent. There are no browser tracking scripts or page-load events.
The [telemetry guide](telemetry.md) lists every field, timing and control.

Contacts can now have no email address. Shared template and broadcast lists can
contain other channels. Permission errors use `403 restricted_api_key`.
IVR reads return `[redacted]` instead of a signing secret; save it at creation
or rotation. The event catalog is paged, and teams can define at most 10,000
custom event types. Review these changes in the release notes before reopening
API traffic.

Calling stays optional. The installer can now add its prebuilt services and
backend settings. Connected gateway calls now expire after inactivity: two minutes
once heartbeat support is confirmed, or a two-hour fallback for older gateways.
API-managed calls are excluded. Existing TURN installs migrate from
`CALL_TURN_PASSWORD` to `CALL_TURN_SECRET`. Docker Compose **2.24.4 or newer** is required.

## 1. Save configuration and back up data

Pause incoming API and webhook traffic at your proxy. Let queued sends and active
calls finish. Stop new broadcasts and automation triggers. Disabling an automation
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
  "$OPENSEND_ENV_FILE" compose*.yaml
dc config --images > "$OPENSEND_BACKUP_DIR/images.txt"
dc images > "$OPENSEND_BACKUP_DIR/running-images.txt"
```

Also copy proxy files, Compose overrides, TLS certificates and any locally built
source revision into the backup. Record immutable image IDs or digests and keep
the old images available. A saved `latest` tag can change after an upgrade.

Preserve `INSTANCE_NAME`, `INSTANCE_SECRET`, `CONVEX_SELF_HOSTED_ADMIN_KEY`,
`BETTER_AUTH_SECRET`, `SSO_ENCRYPTION_KEY` and any legacy `SES_ENCRYPTION_KEY`.
For Convex Cloud, preserve the deploy key and deployment URLs instead of local
backend credentials. Save backend environment settings and external storage
credentials too. Keep the backup private and copy it off the server.

### Script installs

The upgrade command in step 2 takes a data backup automatically. It fetches
release assets, stops the local stack, and archives the actual mounted Convex
volume before changing live configuration or pulling new images. If containers
were removed, it finds the retained volume by the saved project labels.

The installer saves `convex-data.tar.gz`, a private `env`, Compose and proxy
files, and the old backend image identity under `backups/<timestamp>/`.
This covers the database, authentication component and local file storage.
Check that the archive is readable and copy it off the server. A failed backup
aborts the upgrade; services may stay stopped until you fix the failure and retry.
`--no-start` does not take this data backup or deploy anything.

Cloud installs take a file-inclusive `export.zip` using the old migration image.
Check that the pinned CLI exports the components you need, including auth, and
keep the cloud provider's backups too. It is not a whole-volume snapshot.

### Manual Compose installs

For local Convex, take a consistent archive of its mounted volume before
replacing the release assets. The old migration image supplies the archive tool:

```sh
OPENSEND_CONVEX_CONTAINER="$(dc ps -a -q convex)"
OPENSEND_DATA_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$OPENSEND_CONVEX_CONTAINER")"
OPENSEND_BACKUP_IMAGE="$(dc config --images migrate)"
test -n "$OPENSEND_DATA_VOLUME"
docker inspect --format '{{.Image}}' "$OPENSEND_CONVEX_CONTAINER" \
  > "$OPENSEND_BACKUP_DIR/convex-image-id"
dc stop
docker run --rm --pull never --network none --user 0 --entrypoint sh \
  --mount "type=volume,src=$OPENSEND_DATA_VOLUME,dst=/data,readonly" \
  --mount "type=bind,src=$OPENSEND_BACKUP_DIR,dst=/backup" \
  "$OPENSEND_BACKUP_IMAGE" \
  -c 'tar -czf /backup/convex-data.tar.gz -C /data . && tar -tzf /backup/convex-data.tar.gz >/dev/null'
```

Stop if any command fails. If your backend uses a bind mount instead, back up
that stopped directory with your host's backup tool. Do not substitute an empty
or guessed volume name. Keep the original data volume intact.

For Convex Cloud, export instead:

```sh
dc run --name opensend-v1-backup --no-deps -T migrate export \
  --include-file-storage --path /tmp/export.zip
docker cp opensend-v1-backup:/tmp/export.zip "$OPENSEND_BACKUP_DIR/export.zip"
docker rm opensend-v1-backup
```

Keep the one-off container until the copy succeeds. Check table, component and
file coverage before continuing. Save provider backups as well.

Back up separately configured S3 storage, calling recordings and certificates.
The local Convex archive does not contain those external files. See
[Convex file storage](object-storage.md). Do not use `docker compose down -v`.

## 2. Upgrade the installation

Choose the path matching your install. Keep the original proxy, storage and
cloud overrides selected. `COMPOSE_FILE` in your environment file can record
them. For source installations without it, add the same `-f` options to the
`dc` function for every command, including the backup commands above.

### Script install

From the parent directory of your installation:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- upgrade \
  --version v2.0.0 --dir ./opensend --yes
```

Use your actual installation path. Add `--telemetry no` to disable anonymous
statistics before v2 starts. The script preserves saved telemetry settings unless
you explicitly pass that flag. It preserves hostnames, project name, backend
mode, backend image and encryption secrets. Calling stays off unless you opt in.

Saved image overrides take precedence over the release version. Supply matching
images when upgrading a customized installation, for example:

```sh
curl -fsSL https://opensend.cc/install.sh | \
  APP_IMAGE=ghcr.io/panarastudios/opensend-app:v2.0.0 \
  MIGRATE_IMAGE=ghcr.io/panarastudios/opensend-migrate:v2.0.0 \
  SMTP_IMAGE=ghcr.io/panarastudios/opensend-smtp:v2.0.0 \
  sh -s -- upgrade --version v2.0.0 --dir ./opensend --yes
```

Update any calling image overrides too. Return to the installation directory
and recreate `dc` if you opened a new shell. Reapply custom changes to downloaded
assets and keep them in overrides for future upgrades.

### Compose install with release images

Download the `v2.0.0` Compose and Caddy assets from the
[GitHub release](https://github.com/PanaraStudios/opensend.cc/releases/tag/v2.0.0)
into the installation directory. Keep the old assets in the backup.

Set `OPENSEND_VERSION=v2.0.0` in your private environment file. Remove individual
application image overrides or update them to the matching release, including
SMTP and calling images if enabled. Preserve your backend image pin and secrets.
Set `OPENSEND_TELEMETRY=0` now if you want a locked hard off. The migrate service
forwards it into either local Convex or Convex Cloud.

With your saved profiles and overrides selected:

```sh
dc pull
dc stop
dc up -d --wait --no-build convex
dc rm -f migrate
dc up --no-build --no-deps --exit-code-from migrate migrate
dc run --rm --no-deps -T migrate run migrations:backfillCounts
```

Stop if deployment fails. In cloud mode, omit the `convex` command. Start the
application after migration succeeds:

```sh
dc up -d --wait --no-build app
dc ps -a
dc logs --tail=100 migrate app
```

Restart enabled SMTP with `dc --profile smtp up -d --wait --no-build smtp`.
For enabled calling, start Janus, FreeSWITCH, drachtio and voice-agent first,
then call-gateway, as shown in step 4. Restart your saved proxy services too.

### Compose install built from source

Save the old source revision, then check out the release in that installation's
source checkout:

```sh
git fetch origin tag v2.0.0
git switch --detach v2.0.0
pnpm install --frozen-lockfile
OPENSEND_ENV_FILE="$OPENSEND_ENV_FILE" pnpm setup
dc run --rm --no-deps -T migrate run migrations:backfillCounts
```

Use the Node and pnpm versions listed in [self-hosting](self-hosting.md#from-source).
Set `OPENSEND_TELEMETRY=0` in the selected environment file before setup if
needed. `pnpm setup` preserves secrets and data, rebuilds the app and migration
images, and redeploys the backend. Carry your Compose file selection into setup.
Rebuild locally managed SMTP or calling images separately and recreate them.

## 3. Check the migration step

The one-shot `migrate` service waits for a local backend, sets supported backend
environment values, and deploys functions, components, schema and indexes. It
also forwards calling and telemetry settings. In cloud mode it uses the saved
deploy key. Check that it exited with code `0` in `dc ps -a`. Search index builds
can make deployment take longer on a large database.

Migration automatically starts the resumable custom-event counter backfill in
bounded batches. It needs one deployment, with no manual conversion or second
deployment. Teams with existing definitions may briefly see “Custom event counts
are being initialized” when adding a definition. Existing definitions, sends,
updates and deletes remain available. Once counting completes, new definitions
must fit the 10,000-type cap. Existing definitions above it are kept.

The script upgrade also requests `migrations:backfillCounts`. The manual paths
above request the same runner. It rebuilds historical counts and email metrics,
projects stored SES events, rebuilds broadcast reports, queues parsing for stored
inbound mail and removes replaced counter fields. It records progress and runs
in the background; older totals may read low until it finishes. Rerunning resumes
or skips completed work. Monitor with `dc run --rm migrate logs`.

Migration does not import backups or move external files. It does not repair
historical call timestamps or recover object-only files from an earlier v2
storage provider. Messaging works without calling or Meta setup.

## 4. Enable calling, if needed

Prepare a calling DNS name, stable public IPv4 address and trusted WSS certificate.
Use direct public addressing or 1:1 NAT. The scripted setup does not support an
IPv6-only server. Plan for at least 8 GB RAM; busy voice bots may need more.

The certificate directory must contain `wss.pem`: the private key followed by
the full certificate chain for the calling hostname, readable by container UID 10002. Use an absolute directory path. Caddy's app certificate does not configure
FreeSWITCH. The default localhost certificate is only for local testing.

Open these ports in both host and provider firewalls. Forward media ports 1:1:

| Ports           | Purpose                                |
| --------------- | -------------------------------------- |
| TCP 80, 443     | HTTPS app, API and callbacks           |
| TCP 7443        | Browser calling over secure WebSockets |
| UDP 20000–20199 | WhatsApp call media                    |
| UDP 20400–20799 | Browser agent media                    |
| TCP/UDP 3478    | Optional TURN listener                 |
| UDP 20800–20999 | Optional TURN relay media              |
| TCP 5349        | Optional TLS TURN listener             |

Keep SIP and control ports private. Keep the gateway's `8090` host binding on
loopback. UDP 20200–20399 is private media between services. An HTTP proxy cannot
carry UDP media. Public IP advertisement must match the forwarded address.

### Script install

From the parent directory, opt in using the saved release:

```sh
curl -fsSL https://opensend.cc/install.sh | sh -s -- install --dir ./opensend \
  --calling yes --calling-domain calling.example.com \
  --calling-public-ip 203.0.113.10 \
  --calling-cert-dir /srv/opensend-calling-certs --yes
```

Replace the example address and directory. The installer takes another backup,
adds the `calling` profile, generates separate secrets and supplies gateway and
WSS settings to Convex. It uses prebuilt images. Existing profiles, settings and
secrets are kept. These flags can also be supplied with the upgrade command.

For different ports, use `--calling-wss-port`, `--janus-rtp-range`,
`--freeswitch-rtp-range`, `--turn-port` and `--turn-relay-range`. Ranges use
`START-END`; saved values take precedence on later runs.

### Manual Compose install

Add `calling` to your saved `COMPOSE_PROFILES`. Set `OPENSEND_CALLING=1`,
`JANUS_PUBLIC_IP`, `FREESWITCH_PUBLIC_IP`, `FREESWITCH_CERT_DIR`,
`CALL_GATEWAY_URL=http://call-gateway:8090`,
`CALL_GATEWAY_CONVEX_HTTP_URL=http://convex:3211` and
`CALL_AGENT_WSS_URL=wss://calling.example.com:7443` in your private environment
file. Generate distinct values with `openssl rand -hex 32` for
`CALL_GATEWAY_SECRET`, `JANUS_API_SECRET`, `FREESWITCH_ESL_SECRET`,
`FREESWITCH_SIP_SECRET`, `FREESWITCH_DIRECTORY_SECRET`, `DRACHTIO_SECRET` and
`VOICE_AGENT_SECRET`. Keep secrets out of shared shell history.

Redeploy the backend settings, then start the media services and controller:

```sh
dc --profile calling pull
dc rm -f migrate
dc up --no-build --no-deps --exit-code-from migrate migrate
dc --profile calling up -d --wait --no-build --no-deps \
  janus freeswitch drachtio voice-agent
dc --profile calling up -d --wait --no-build --no-deps call-gateway
curl --fail http://127.0.0.1:8090/healthz
```

For source-managed images, build those services instead of pulling them.
Scripted calling requires local Convex. Cloud actions need a separately secured
HTTPS route to the gateway and your cloud HTTP site as the callback origin.
Follow the [manual gateway guide](calling-gateway.md#configuration-and-operation).
Never expose the private agent directory through the public proxy.

### Optional TURN for browser agents

Agents behind strict NAT or firewalls may register successfully but get no audio.
For script installs, add `--turn yes` alongside `--calling yes`. The installer
adds `calling-turn`, sets your coturn STUN and TURN URLs, and generates a private
`CALL_TURN_SECRET`. Existing STUN overrides are preserved. Older installations
using `CALL_TURN_PASSWORD` get a new shared secret and have the old password
removed. Upgrade both coturn and the backend, then reconnect agents.

For manual installs, add `calling-turn` to the saved profiles. Set
`CALL_TURN_PUBLIC_IP`, a new `CALL_TURN_SECRET`,
`CALL_STUN_URLS=stun:calling.example.com:3478` and
`CALL_TURN_URLS=turn:calling.example.com:3478?transport=udp,turn:calling.example.com:3478?transport=tcp`
in the environment file. Remove `CALL_TURN_PASSWORD`. The new coturn uses the
shared secret; the migration service supplies the same secret and URLs to Convex.
It never sends that shared secret to browsers.

```sh
dc --profile calling --profile calling-turn pull coturn
dc rm -f migrate
dc up --no-build --no-deps --exit-code-from migrate migrate
dc --profile calling --profile calling-turn up -d --wait --no-build coturn
```

Agents receive one-hour credentials tied to their authorized browser session.
They refresh before expiry. TURN also provides your own STUN endpoint. If the
URLs or secret are missing, the browser uses STUN only; without a STUN override,
it uses the default Google STUN server. Coturn blocks private network peers, so
FreeSWITCH must advertise a reachable public media address. TURN serves browser
agents, not Meta-to-Janus or voice-bot media.

For optional TLS, mount a trusted TURN certificate directory with
`CALL_TURN_CERT_DIR`, set `CALL_TURN_CERT_FILE=/certs/turn.crt` and
`CALL_TURN_KEY_FILE=/certs/turn.key`, and set `CALL_TURN_TLS_PORT=5349`. Publish
that port in an override saved in `COMPOSE_FILE`:

```yaml
services:
  coturn:
    ports:
      - "${CALL_TURN_TLS_PORT:-5349}:${CALL_TURN_TLS_PORT:-5349}/tcp"
```

Add `turns:calling.example.com:5349?transport=tcp` to `CALL_TURN_URLS`, rerun
migration and recreate coturn. Use a TLS port distinct from WSS and plain TURN.
Leave both certificate path variables unset to disable TLS. If either is set,
both files must be readable or coturn will not start. Restart coturn and
FreeSWITCH between calls after renewing their certificates.

Choose a number's calling mode and routing in Channels, with Meta SIP mode
disabled. Add provider keys, render IVR prompts and test the bot or menu before
assigning it. Outbound calls need recipient permission and Meta eligibility.
Save IVR signing secrets when created or rotated; rotating stops the old secret
immediately. See [browser calling](browser-softphone.md) for team queues and
[calling setup](calling-gateway.md) for routing and recording configuration.

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
Complete business verification and required permission review. Development-mode
access is limited by Meta; installing the stack does not grant production access.

For Embedded Signup, save the WhatsApp configuration ID and allow your dashboard
domain in the app. Page connections use a separate Facebook Login configuration
ID. Manual token connections are also available. Teams then connect senders in
Channels. WhatsApp numbers must be registered; templates need Meta approval.
Test with real accounts before enabling production sends or calls.

## 6. Check telemetry settings

In setup or **Instance → Amazon SES**, turn **Share anonymous usage statistics**
off if desired. **View what's sent** previews the current payload without a
network request. Turning sharing off stops the next ping, including a queued one.
No goodbye ping is sent.

`--telemetry no` writes `OPENSEND_TELEMETRY=0` to the install's `.env`. Upgrades
keep it unless you explicitly supply a different telemetry flag. For manual
Compose, set `OPENSEND_TELEMETRY=0` in the selected environment file and rerun
migration. To apply a hard off directly to the backend:

```sh
dc run --rm migrate env set OPENSEND_TELEMETRY 0
```

For a source or cloud deployment managed outside Compose, use
`pnpm exec convex env set OPENSEND_TELEMETRY 0` against the intended deployment.
The override prevents telemetry requests and locks the dashboard switch off.
Unsetting it or changing it to `1` resumes the saved preference; without a
preference, sharing defaults to on. See [telemetry](telemetry.md) for the exact
schema 1 payload and daily schedule.

The app's `NEXT_TELEMETRY_DISABLED=1` and local Convex's `DISABLE_BEACON: "true"`
control framework telemetry separately. They do not disable opensend.cc's
anonymous statistics, call transcripts, usage records or logs.

## 7. Verify before reopening traffic

- Check `dc ps -a` and migration logs. The app and backend should be healthy,
  and the migration container should have exited successfully. Check backfill
  progress before relying on historical totals.
- Sign in with an existing account. Check its team, domains, contacts, templates,
  automations and broadcast history. Open an old email and download an old file.
- Send a test email through your existing `/emails` integration. Check receipt,
  delivery status and your signed customer webhook.
- Check nullable contact emails, mixed-channel lists and permission errors in
  your client. If adopting `/messages`, follow `next_cursor` through every page.
  For `/events/catalog`, keep following `next_cursor` with `after` until
  `has_more` is false. Test a saved trigger beyond the first catalog page.
- Try a Custom key on its allowed resource and an excluded resource. Confirm
  the latter returns `403`. Revoke the test key afterwards.
- Check the usage-statistics preference and payload preview. A hard off should
  show the switch off and locked.
- If Meta is enabled, send and receive a real message on each connected channel.
  Check template approval, conversation windows and delivery webhooks.
- If calling is enabled, test inbound audio, keypad input, agent handoff, a bot
  call and an outbound call after permission. Test remote and local hangup.
  Check transcripts and separately configured recording ingestion. Read an IVR
  with a read-scoped key and confirm its secret is `[redacted]`.
- Test browser agents on the networks your team uses. **Relay: on** means TURN
  is available; check the selected relay candidate in browser WebRTC diagnostics
  to confirm that a restrictive-network test actually used it.

Use the [live checklist](qa/live-checklist.md) for the full real-provider check.
Reopen traffic and restart intended automation triggers after verification.

## 8. Roll back from the backup

A rollback restores the backup's point in time. Later sends cannot be unsent,
and later database changes will be lost from the restored instance. Pause traffic
again and let active jobs and calls finish. Save a separate v2 backup for later
review. Stop the v2 stack before starting a restored stack on the same ports.

Restore local Convex into a **new project and data volume**. Older binaries may
not understand an upgraded database. Keep the v2 volume and your only backup
intact. Use the old release assets, private environment, proxy files and immutable
images saved before the upgrade.

For an installer backup, copy `env` to `.env` in a separate restore directory,
and copy its Compose and `docker/` files there. For a manual backup, extract
`config.tgz` into that directory and restore the other saved files. Set
`CONVEX_IMAGE` to the image ID recorded in `convex-image-id`, confirming that it is an immutable ID or digest. Replace any
`latest` tags with the saved image IDs or digests. Restore external storage
settings and matching file bytes from their separate backup.

From the restore directory, using your original environment filename:

```sh
OPENSEND_ENV_FILE=.env
# Use .env.docker if that is the restored filename.
OPENSEND_RESTORE_PROJECT=opensend-v1-restore
OPENSEND_BACKUP_DIR=/absolute/path/to/the/backup
restore_dc() {
  docker compose --project-name "$OPENSEND_RESTORE_PROJECT" \
    --env-file "$OPENSEND_ENV_FILE" "$@"
}
restore_dc create --no-build convex
OPENSEND_RESTORE_CONTAINER="$(restore_dc ps -a -q convex)"
OPENSEND_RESTORE_VOLUME="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{if eq .Type "volume"}}{{.Name}}{{end}}{{end}}{{end}}' "$OPENSEND_RESTORE_CONTAINER")"
OPENSEND_RESTORE_IMAGE="$(restore_dc config --images migrate)"
test -n "$OPENSEND_RESTORE_VOLUME"
docker run --rm --pull never --network none --user 0 --entrypoint sh \
  --mount "type=volume,src=$OPENSEND_RESTORE_VOLUME,dst=/data" \
  --mount "type=bind,src=$OPENSEND_BACKUP_DIR,dst=/backup,readonly" \
  "$OPENSEND_RESTORE_IMAGE" \
  -c 'tar -xzf /backup/convex-data.tar.gz -C /data'
restore_dc up -d --wait --no-build convex
restore_dc rm -f migrate
restore_dc up --no-build --no-deps --exit-code-from migrate migrate
restore_dc up -d --wait --no-build app
restore_dc ps -a
```

Confirm that the new volume is empty before extraction. If your Compose overrides
name volumes explicitly or use bind mounts, change those to separate restore
locations too. Stop if any command fails. Restart the restored proxy and old SMTP
services after migration succeeds. Source installs need the saved v1 source
revision and matching rebuilt images.

For Convex Cloud, use the provider's restore process or a separate deployment
with the original secrets. The file-inclusive export can be imported with the
matching CLI:

```sh
docker compose --env-file .env.restore run --rm \
  -v "$OPENSEND_BACKUP_DIR:/backup:ro" migrate \
  import --replace-all --yes /backup/export.zip
```

Configure `.env.restore` for the intended restore deployment first. Confirm auth
component and file coverage; the export is not a substitute for provider backups.
`--replace-all` replaces deployment data. Never target the only working deployment
by mistake. Restore saved backend environment values separately.

Repeat the existing-account, old-file and test-email checks before reopening
traffic. Keep both the failed v2 volume and backup until recovery is verified.
