# OAuth applications

Opensend supports public and confidential registered applications. Each authorization belongs to one team and the verified admin who approved it. Application registration is public; registration does not create an Opensend account or bypass invitation-only account registration.

## Available APIs

All URLs use the running application's public origin, configured by `SITE_URL`.

| Endpoint | Purpose |
| --- | --- |
| `POST /oauth/register` | Register an application (JSON) |
| `GET /oauth/authorize` | Start browser login and team consent |
| `POST /oauth/token` | Exchange a code or rotate a refresh token |
| `POST /oauth/revoke` | Disconnect the authorization associated with a token |
| `POST /oauth/introspect` | Inspect your application's token |
| `GET /oauth/grants` | List authorizations for the token's team |
| `DELETE /oauth/grants/:id` | Revoke an authorization in the token's team |
| `GET /.well-known/oauth-authorization-server/oauth` | Authorization-server metadata (root alias also available) |
| `GET /oauth/jwks` | Public signing keys |

`full_access` permits grant listing and revocation. `emails:send` reserves permission for sending, but **email sending and other product APIs are not implemented on this branch**. Account security and membership management never accept OAuth tokens. Hosted client metadata discovery is deferred.

## Register and authorize

```sh
curl "$OPENSEND_URL/oauth/register" -H 'Content-Type: application/json' -d '{
  "client_name": "Example integration",
  "redirect_uris": ["https://example.com/oauth/callback"],
  "scope": "full_access",
  "token_endpoint_auth_method": "client_secret_basic"
}'
```

Choose explicit scopes at registration and authorization: `emails:send`, `full_access`, or both separated by spaces. `offline_access` is handled internally, with ongoing access disclosed on the consent screen. Unknown scopes fail. Keep a returned client secret on your backend; it is shown only at creation or rotation. Public clients use `none`; confidential clients use `client_secret_basic` or `client_secret_post`.

Callbacks are matched exactly. HTTPS, HTTP loopback (`127.0.0.1`, `[::1]`, `localhost`), and reverse-domain native schemes such as `com.example.app:/callback` are supported. Register the exact loopback port. Credentials, fragments, wildcards, unsafe schemes, and remote HTTP callbacks fail validation.

Generate a random PKCE verifier (43–128 characters) and its base64url SHA-256 challenge. Generate random `state` and keep both in the initiating client's session. Open:

```text
/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=ENCODED_CALLBACK&scope=full_access&state=STATE&code_challenge=CHALLENGE&code_challenge_method=S256
```

The user signs in, completes verification/MFA/required SSO, explicitly selects an admin team, and authorizes. Validate `state` when the browser returns. Errors and cancellation remain on the consent screen; they never redirect to an unvalidated callback. Consent expires after ten minutes and is bound to an HttpOnly browser cookie. Changing the dashboard team does not change consent's team.

Exchange the code within two minutes:

```sh
curl "$OPENSEND_URL/oauth/token" -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=authorization_code -d code="$CODE" \
  --data-urlencode redirect_uri="$CALLBACK" -d code_verifier="$VERIFIER"
```

Public clients send `client_id` without a secret. `client_secret_post` clients send both fields in the body. Both client types require S256 PKCE. Token, revocation and introspection requests accept JSON or form encoding. Access tokens last 15 minutes. Refresh tokens rotate and expire after 30 days; replace the saved refresh token atomically after each successful refresh. Do not retry a consumed code or refresh token: replay invalidates the authorization, including tokens issued by a concurrent request.

```sh
curl "$OPENSEND_URL/oauth/grants" -H "Authorization: Bearer $ACCESS_TOKEN"
curl "$OPENSEND_URL/oauth/token" -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d grant_type=refresh_token -d refresh_token="$REFRESH_TOKEN"
curl "$OPENSEND_URL/oauth/revoke" -u "$CLIENT_ID:$CLIENT_SECRET" -d token="$REFRESH_TOKEN"
```

Run `OPENSEND_URL=http://localhost:3000 node examples/oauth/local-client.mjs` for an executable local client. It listens on a random loopback port, registers, authorizes, calls the real grant API, refreshes, and disconnects. Tokens remain in memory.

## Test each step manually

Keep your running Opensend services open. In another terminal in this repository, run:

```sh
node examples/oauth/local-client.mjs --manual
```

The default Opensend address is `http://localhost:3000`. For a different address, prefix the command with `OPENSEND_URL=http://localhost:YOUR_PORT`.

Open the printed authorization URL, choose your team, and authorize **Manual OAuth test**. Keep **Profile → OAuth apps** open in another tab. The row appears after approval and stays there until you revoke it.

Type these commands one at a time at the `oauth>` prompt:

| Command | What to check |
| --- | --- |
| `exchange` | Run within two minutes of approval. Tokens are received; the UI row stays. |
| `grants` | Lists your selected team's authorizations through the API. |
| `introspect` | Shows `active: true` for the access token. |
| `inspect-refresh` | Shows `active: true` for the refresh token. |
| `refresh` | Rotates the refresh token; the UI row stays. |
| `discovery` | Displays server metadata. |
| `keys` | Displays public signing keys. |

Choose one revocation method: use the row's **⋯ → Revoke access** action in Opensend, type `revoke` to call the token revocation endpoint, or type `revoke-grant` to call the grant deletion endpoint. The UI row disappears. Then `introspect` reports `active: false`, and `grants` and `refresh` fail.

Use `authorize` to start a new consent flow with the same registered client. For refresh replay testing, authorize, `exchange`, `refresh`, then `replay-refresh`: the old token is rejected and the authorization is revoked. To test Cancel, open a fresh authorization URL and cancel in the browser; no new row is added.

`quit` exits without revoking; you can still remove the connection from Opensend's UI. Tokens live only in the terminal process's memory. For a sending-only authorization, start a new example with `OPENSEND_SCOPE=emails:send node examples/oauth/local-client.mjs --manual`; `grants` and `revoke-grant` should be refused, while token refresh and `revoke` still work. Email sending itself remains deferred.

## Operators

These functions are internal and require the deployment admin CLI. Select the correct local environment with `OPENSEND_ENV_FILE` when needed.

```sh
pnpm backend run oauthAdmin:list
pnpm backend run oauthAdmin:register '{"name":"Example","redirects":["https://example.com/callback"],"scope":"emails:send","method":"none"}'
pnpm backend run oauthAdmin:maintain '{"clientId":"ID","operation":"update","name":"New name"}'
pnpm backend run oauthAdmin:maintain '{"clientId":"ID","operation":"rotate"}'
pnpm backend run oauthAdmin:maintain '{"clientId":"ID","operation":"disable"}'
pnpm backend run oauthAdmin:maintain '{"clientId":"ID","operation":"delete"}'
```

Maintenance invalidates existing authorizations. Reconnect after updating or rotating credentials. Persistent limits allow 20 registrations/hour, 120 authorization starts/minute, 300 token operations/minute globally, and 60/minute per authenticated client. Counters are transactional and survive restarts. Operators should size these conservative limits for their deployment. There is a limit of 100 live authorizations per user and per team; disconnect an application before adding more.

## Revocation and backend integration

Profile shows the signed-in user's authorizations across teams. Settings → Team → Authorized apps shows all live authorizations for the selected team to its admins, including authorizations created by other admins. Both views share the same records and revocation controls. Disconnect takes effect immediately. Ordinary logout preserves integrations. Password reset, admin removal/demotion, user/team deletion, app maintenance, and SSO connection/policy changes invalidate access. Reconnecting creates a new grant ID, so old tokens cannot become valid again.

`authorizeOAuth` in `convex/oauthHttp.ts` checks signature, expiration, separate issuer/audience, and live authorization, returning user, team, application, grant, and scopes. Future product endpoints must also call `liveGrant` and check resource ownership **inside the mutation/query that reads or writes the resource**. Never use the dashboard session helper for an OAuth token. The current grant API demonstrates this second check.

OAuth signing keys live in `oauthJwks`, separate from dashboard keys. Client secrets, authorization codes, and refresh tokens are hashed. Convex transaction reservations make upstream code consumption and refresh rotation exclusive across workers; persistent replay tombstones and live grants prevent a late racing token issuance from restoring revoked access. The upstream Better Auth provider retains responsibility for PKCE verification, protocol code issuance, refresh token generation and signing.

Schema additions preserve existing auth tables and data. No auth reset or migration import is required.

## Verification

Verified on 2026-09-20 on `feat/oauth-apps`:

- `pnpm lint` and `pnpm typecheck` pass.
- 200 existing dashboard unit tests and 31 Convex/auth/OAuth tests pass.
- `pnpm test:e2e`: all 18 Docker Playwright tests pass. OAuth coverage includes public clients, both confidential authentication methods, hosted/loopback/native callbacks, real token exchanges and grant APIs, PKCE rejection, scope escalation rejection, refresh replay, API/UI revocation, synchronized Profile and Team authorization lists, logout survival, issuer separation, and browser continuation through MFA and required SSO.
- Local and Docker production builds pass. The Docker image passes its health checks and the browser/API flows above. OAuth grants and keys survive backend restart; existing account/team/SSO restart tests also pass.
- Consent and Profile were checked at 390px and 1440px in light and dark modes. Screenshots and the HTML test report are generated under `test-results/` and `playwright-report/` (ignored by Git).
- Disposable Docker stacks and volumes were removed. No merge into `master` was performed.
