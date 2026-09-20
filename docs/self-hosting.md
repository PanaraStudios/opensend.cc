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

```sh
docker compose --env-file .env.docker logs -f app convex
pnpm backend logs --history 100
```

Convex owns persistent database and avatar storage in the `convex-data` volume. `docker compose down` preserves it. `docker compose down -v` deletes it and is not a routine shutdown command. Auth emails are Convex function logs, not Next.js logs. Function console output is redacted from ordinary clients by the backend container.

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
