# REST API

The API follows [Resend's API reference](https://resend.com/docs/api-reference) so existing Resend clients work with a changed base URL. It is served from the Convex site URL (the dashboard shows it as `https://api.opensend.cc`).

## Authentication

Send `Authorization: Bearer <token>` with either:

- an API key (`os_…`) from **API keys** in the dashboard or `POST /api-keys`. Full access reaches every endpoint; sending access reaches only the sending endpoints, and a sending key limited to a domain may only send from it. A key whose domain was removed can no longer send.
- an [OAuth](oauth-apps.md) access token. `full_access` acts like a full-access key, `emails:send` like a sending key.

Keys are stored as SHA-256 hashes; the token is shown once. Any team member can create, edit and delete keys, as in Resend.

## Behaviour shared by every endpoint

| | |
| --- | --- |
| Errors | `{ "statusCode", "name", "message" }` with Resend's names: `missing_api_key` (401), `restricted_api_key` (401), `invalid_api_key` (403), `invalid_permission` (403, OAuth scope), `not_found` (404), `validation_error` / `missing_required_field` (422), `invalid_idempotency_key` (400), `invalid_idempotent_request` and `concurrent_idempotent_requests` (409), `rate_limit_exceeded` (429), `application_error` (500). |
| Rate limit | 10 requests per second per team, shared by all its keys. Every authenticated response carries `ratelimit-limit`, `ratelimit-remaining` and `ratelimit-reset`; a 429 adds `retry-after` (seconds). |
| Idempotency | `Idempotency-Key` (1–256 characters) on any POST. The same key and body within 24 hours replays the first response; a different body is a 409. A server error releases the key. |
| Lists | `limit` (1–100, default 20) with `after` or `before` an id, newest first; responses are `{ "object": "list", "has_more", "data" }`. |
| Bodies | JSON, up to 1 MB. |
| CORS | None: the API is for servers, like Resend's. |
| Logs | Every request that authenticates to a team is logged (Logs in the dashboard, `GET /logs`), failures included, with `authorization` and cookies redacted and bodies cut at 64 KB. Logs are kept 30 days. |

## Endpoints

| Endpoint | Notes |
| --- | --- |
| `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/{id}` | As Resend. |
| `POST /domains`, `GET /domains`, `GET /domains/{id}`, `PATCH /domains/{id}`, `POST /domains/{id}/verify`, `DELETE /domains/{id}` | As Resend, backed by the same logic as the dashboard. |
| `GET /logs`, `GET /logs/{id}` | As Resend. |
| `POST /events`, `GET /events`, `GET /events/{id}`, `PATCH /events/{id}`, `DELETE /events/{id}` | Custom event definitions, as Resend. `{id}` is the event's id or its name. Backed by the same rules as the dashboard's Events page. |
| `POST /events/send` | Sends a custom event for one contact, as Resend: `event`, exactly one of `contact_id` or `email`, and an optional `payload` object. Answers 202 `{ "object": "event", "event" }`. |

## Deviations from Resend

- Ids are Convex document ids, not UUIDs.
- Domains: `region` defaults to the installation's default region. A new domain starts with opportunistic TLS, sending on and receiving off; change `tls` and `capabilities` with `PATCH` once it is provisioned (a create asking otherwise is a 422). Open and click tracking are not available: `open_tracking`/`click_tracking` are always `false` and asking to enable them is a 422. `POST /domains/{id}/verify` retries a failed setup or starts a DNS check; checks are limited to one per domain every 10 seconds. Deleting a domain queues its removal from AWS.
- Events: names starting with `opensend:` (Resend: `resend:`) are reserved. A schema has at most 50 properties and property names use letters, numbers and underscores. Like Resend, every endpoint needs a full-access key: a sending key may only send emails.
- `POST /events/send`: a defined event's payload must carry every schema property with its type (`date` is an ISO 8601 string), or the send is a 422 naming each problem; values are not coerced. An event nobody defined is accepted as sent and is not defined by it. An `email` with no contact yet is accepted, and the contact is created when an automation run starts, as Resend does; an unknown `contact_id` is a 404. Payloads are limited to 64 KB and 32 levels of nesting, and object keys must be printable ASCII not starting with `$` (a Convex storage rule). Sent events are kept 30 days. There is no client-supplied event id; use `Idempotency-Key` to make a retry safe. Sent events are not delivered to webhooks (Resend's webhooks carry only its own event types).
- Requests that fail before a team is known (no key, an unknown key) are answered but not logged.

## Adding an endpoint

Register it with `apiRoute` from `convex/api/route.ts` in the resource's own module and call its `register…Routes` from `convex/api/http.ts`. The comment on `apiRoute` describes the handler contract.
