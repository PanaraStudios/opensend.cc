# Self-hosted Opensend

Authentication and team administration use Better Auth 1.6.15 in a locally installed Convex component. Email sending, audiences, automations and the other dashboard resources remain demo data in this release. Demo data is stored separately for each authenticated user and team. Existing demo identities and memberships are never imported.

## Start

Install Docker with Compose, Node 22, and pnpm 11.7.0. Run:

```sh
pnpm install --frozen-lockfile
pnpm setup
```

The setup command generates `.env.docker` with mode 0600, starts Convex, generates its admin key, sets the auth secrets in Convex, deploys functions, and builds and starts the application and dashboard. Running it again preserves secrets and the persistent volume. Keep `.env.docker` private and back it up. The Next.js container never receives the deployment admin key, Better Auth secret, or SSO encryption key.

Open http://localhost:3000/signup. The first account claims instance setup atomically. Verify its email, sign in, and create a team. Subsequent accounts require a pending invitation matching their email. Deleting the first account does not reopen registration. A team invitation does not become a membership until the recipient accepts it.

The first account is the installation administrator: only it can change the AWS connection, regions and other instance-wide SES settings. Inside a team, every member manages the product (domains, keys, emails, audience); team admins also manage members, invitations, SSO and the team itself. To hand the installation administrator role to another verified account, run:

```sh
pnpm backend run installationAdmin:transfer '{"email":"new-admin@example.com"}'
```

Auth emails currently use a console transport. View them in the Convex dashboard at http://localhost:6791, or use the helper below. Each message is one JSON log entry with recipient, subject, content, and actionLink. These logs contain sign-in and recovery links; restrict log access. SMTP is not configured.

```sh
pnpm backend logs --history 50
```

The dashboard asks for the admin key in `.env.docker`. Treat dashboard access as administrative access to all stored data. Its port and both backend ports bind to loopback by default.

## URLs and production

Before the first setup, create `.env.docker` with your `SITE_URL`, `CONVEX_PUBLIC_URL`, and `CONVEX_PUBLIC_SITE_URL` overrides. Setup fills missing secrets without changing supplied values. Use HTTPS reverse proxies for all three public origins, including WebSocket forwarding for Convex. The app uses `http://convex:3210` and `http://convex:3211` internally. The browser receives only `CONVEX_PUBLIC_URL`, at request time. The same built app image can run under different hostnames.

The auth issuer is the public Convex HTTP origin. It must be reachable from Convex itself so it can retrieve its JWT signing keys. In Docker, public `localhost:3211` works only with the default backend HTTP port. For other local port mappings, use a hostname reachable from both the host and containers. Linux may require a `host.docker.internal:host-gateway` extra-host mapping for local OIDC tests.

Images are pinned by digest. No `NEXT_PUBLIC_*` hostname is baked into the app image. Do not publish the dashboard or backend administrative key. Set up TLS at your reverse proxy before using real accounts.

## Development

```sh
cp .env.example .env.local
docker compose --env-file .env.docker stop app
pnpm dev
pnpm backend dev --once
```

`pnpm backend` reads credentials from `.env.docker`, explicitly selects the self-hosted backend and never selects a cloud deployment. Use `OPENSEND_ENV_FILE=/absolute/path/to/file` for another instance. `COMPOSE_PROJECT_NAME` selects an isolated Compose project; use different ports as well. Backend operations verify a live session and current membership; a valid but revoked JWT cannot authorize a request.

The local component is `convex/betterAuth`. `convex/authOptions.ts` supplies the shared configuration to the runtime, adapter and schema generator. Regenerate after changing plugin schema options:

```sh
cd convex/betterAuth
pnpm dlx auth@1.6.15 generate --config auth.ts --output generatedSchema.ts --yes
cd ../..
pnpm backend dev --once
```

Custom indexes and policy tables live in `schema.ts`, outside the generated file. Generic Better Auth organization endpoints are intentionally blocked. Opensend uses atomic component mutations for team administration so concurrent role changes and deletion cannot orphan a shared team. Account deletion requires a session created within the last five minutes. Password resets revoke existing sessions. Local MFA protects password sign-in; OIDC authentication relies on the identity provider's policies.

## Webhooks

Webhooks are signed exactly as Svix signs them (`svix-id`, `svix-timestamp`, `svix-signature`), so Resend's and Svix's verification libraries work unchanged. Signing secrets are encrypted with `SSO_ENCRYPTION_KEY`; changing that key makes existing secrets unreadable, so rotate every webhook's secret afterwards. Failed deliveries are retried on Svix's schedule (immediately, 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h), and an endpoint that has failed for five days is disabled. Rotating a secret replaces it at once: every attempt after that, retries included, is signed with the new secret only. Endpoints must be public HTTPS hosts: every address a host resolves to is checked before each attempt, and redirects are not followed. Deliveries and outbox events are kept for 90 days.

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

Without a configured sender, account emails, including action links, appear in
Convex function logs so initial setup works. With a sender configured, failures
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

Dropdowns have no page controls. Segments and custom properties use their existing
team limits (500 and 100). Contacts, custom events and domains offer up to 100
prefix matches; templates offer up to 100 search matches by name/alias. Search
reads the whole team's index, so older options remain reachable beyond the initial
100. The metrics chart's compact domain breakdown shows up to 100 domains in name
order; searching and selecting a domain reads that domain directly. Headline
metrics always cover the full selected scope. Tenant status badges use
sentence-case labels and the existing success/warning tones.

The Logs user-agent filter seeks distinct values in the team's retained log index,
independently of the loaded page or current filters. It offers the first 100 values
in lexical order; duplicate requests consume no extra slots. No separate backfill
job is needed, and options disappear when their last retained log is deleted.

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

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:auth
pnpm build
```

The Playwright suite starts a fresh Docker project named `opensend-e2e`, with a separate Convex volume, the production app image, dashboard and Keycloak. It uses app port 3400, Convex ports 3410/3411, dashboard port 6792 and OIDC port 8180. It leaves the main instance untouched and removes the test volume on completion.

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The HTML report is in `playwright-report/`. Failure traces, screenshots and test email logs are in `test-results/`; these directories are ignored by Git. Set `OPENSEND_KEEP_E2E=1` to preserve the test containers after a debugging run. The next run resets only that test project. The suite drives the UI and checks direct backend authorization, and also renders all existing dashboard sections under a real session.

`test:auth` covers bootstrap concurrency, invitation restrictions, cross-team access, role escalation, last-admin safety, deletion, revoked sessions and SSO proofs. The production API smoke script covers verification, password reset, email change, MFA/backup codes, invitations, avatars and deletion. Run it only against a fresh disposable deployment:

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
Username is `resend`; password is an Opensend `os_` API key with sending or full
access. These match [Resend's SMTP credentials and TLS modes](https://resend.com/docs/send-with-smtp).
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
   in `.env.docker`. Also set **SMTP_HOST** in the Convex deployment environment
   to the same hostname so the existing settings tab displays it. It is an
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
A Bcc-only envelope is supported. `Resend-Idempotency-Key` becomes the existing
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

For Caddy, restrict [on-demand TLS](https://caddyserver.com/docs/automatic-https#on-demand-tls)
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
`ses:PutConfigurationSetTrackingOptions` remains in IAM policy revision 2 for
compatibility but is unused and can be removed in a future policy revision.
No IAM revision changed in this update.

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
