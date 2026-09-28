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
| `POST /emails`, `POST /emails/batch` | Queues transactional mail through the team's SES tenant. Sending-access or full-access credentials. Returns `{ "id" }` or `{ "data": [{ "id" }] }`. |
| `GET /emails`, `GET /emails/{id}` | Sent-email metadata and, on retrieval, the HTML and plain text. Full access required. |
| `PATCH /emails/{id}`, `POST /emails/{id}/cancel` | Reschedule with `scheduled_at`, or cancel a scheduled email. Full access required. Returns `{ "object": "email", "id" }`. |
| `POST /events`, `GET /events`, `GET /events/{id}`, `PATCH /events/{id}`, `DELETE /events/{id}` | Custom event definitions, as Resend. `{id}` is the event's id or its name. Backed by the same rules as the dashboard's Events page. |
| `POST /events/send` | Sends a custom event for one contact, as Resend: `event`, exactly one of `contact_id` or `email`, and an optional `payload` object. Answers 202 `{ "object": "event", "event" }`. |

## Deviations from Resend

- Ids are Convex document ids, not UUIDs.
- Domains: `region` defaults to the installation's default region. A new domain starts with opportunistic TLS, sending on and receiving off; change `tls` and `capabilities` with `PATCH` once it is provisioned (a create asking otherwise is a 422). `open_tracking`, `click_tracking` and `tracking_subdomain` work as in Resend, on create and `PATCH`: the subdomain can change but not be removed, and tracking starts once its `Tracking` CNAME record is verified. Tracked links use HTTP (SES's HTTP redirect option); HTTPS tracking needs a CDN and certificate Opensend does not create. Turning receiving on in a region SES does not receive mail in is a 422. `POST /domains/{id}/verify` retries a failed setup or starts a DNS check; checks are limited to one per domain every 10 seconds. Deleting a domain queues its removal from AWS.
- Events: names starting with `opensend:` (Resend: `resend:`) are reserved. A schema has at most 50 properties and property names use letters, numbers and underscores. Like Resend, every endpoint needs a full-access key: a sending key may only send emails.
- `POST /events/send`: a defined event's payload must carry every schema property with its type (`date` is an ISO 8601 string), or the send is a 422 naming each problem; values are not coerced. An event nobody defined is accepted as sent and is not defined by it. An `email` with no contact yet is accepted, and the contact is created when an automation run starts, as Resend does; an unknown `contact_id` is a 404. Payloads are limited to 64 KB and 32 levels of nesting, and object keys must be printable ASCII not starting with `$` (a Convex storage rule). Sent events are kept 30 days. There is no client-supplied event id; use `Idempotency-Key` to make a retry safe. Sent events are not delivered to webhooks (Resend's webhooks carry only its own event types).
- Requests that fail before a team is known (no key, an unknown key) are answered but not logged.

## Sending email

`POST /emails` accepts `from`, `to`, `cc`, `bcc`, `reply_to`, `subject`, `html`,
`text`, `headers`, `attachments`, `tags`, `scheduled_at`, and
`template: { id, variables }`. Address fields accept a string or array, except
`from`, which is one mailbox. `to` is required; SES limits the combined `to`,
`cc`, and `bcc` to 50 recipients. The sender must belong to the team's verified,
sending-enabled domain. A domain-restricted key cannot send from another domain.
The IAM policy, region and tenant must also be ready to send.

Templates must be published; their id or alias is accepted. Explicit sender,
subject and reply-to override template defaults. Template sends cannot also
provide HTML or text. When HTML is supplied without text, plain text is derived.
The existing template renderer's variable conventions still apply, including
its support for names such as `FIRST_NAME` (a difference from Resend's reserved
template names).

Scheduling accepts ISO 8601 or natural language, including `in 1 hour`,
`tomorrow at 9am`, and `Friday at 3pm ET`, up to 30 days ahead. Unrecognized
expressions return 422; times without a timezone use UTC. Past send times queue
immediately. Rescheduling requires a future time. Cancel and reschedule race
atomically with release into the send queue: once released, either change
returns 422. A successful cancellation prevents every stale worker from sending.
Batch requests validate all 1–100 messages together, support scheduling and
templates, and reject attachments.

Attachments accept base64 `content`, `filename`, optional `content_type`, and
optional `content_id` for inline images. URL `path` attachments are deliberately
rejected with 422; no outbound URL fetch occurs. Unsupported SES file extensions,
invalid MIME metadata, and malformed base64 also return 422. Base64 attachments
are capped at 40 MiB in aggregate. The send endpoint allows a larger JSON body
than the default endpoint limit, but the deployed Convex HTTP/proxy limit can be
lower. Email HTML, text and headers together are capped at 900,000 UTF-8 bytes
to fit one Convex content document. Custom headers cannot override fields SES
builds itself. There are at most 50 headers and 48 user tags (two SES tags are
reserved for `opensend_email` and `opensend_team`). `topic_id` is not supported.
Transactional sends do not automatically add List-Unsubscribe headers.

Every send passes `TenantName` and `ConfigurationSetName`. The queue reserves
the full recipient cost against the region's SES send rate. Only explicit SES
throttling or 5xx failures retry, with bounded backoff. A timeout or crashed
worker has an ambiguous outcome because SES has no send idempotency token;
it is recorded as failed without automatic resend. API idempotency protects
repeated HTTP submissions, not a provider accepting a message without returning
its response.

Team suppressions drop matching recipients before submission. If no recipients
remain, the email is recorded as suppressed. Manual suppressions stay in
Opensend because [SES's suppression API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutSuppressedDestination.html)
only accepts bounce or complaint reasons. Removing a bounce/complaint queues a
tenant-scoped SES suppression removal in each provisioned region; provider
failures are logged for the operator. Suppressions themselves do not expire.

Emails, content, attachments, recipient history and timeline entries are kept
for 30 days after sending/failure, matching [Resend's standard retention](https://resend.com/security/gdpr).
Pending scheduled/queued work is protected from cleanup. The sender emits
`email.sent`, `email.scheduled`, `email.failed` and `email.suppressed`; delivery,
bounce, complaint, open/click projection and automatic suppressions belong to
SES event processing. Dashboard metrics and the broadcast editor's Send test
remain demo features until their respective lanes are integrated.

References: [send](https://resend.com/docs/api-reference/emails/send-email),
[batch](https://resend.com/docs/api-reference/emails/send-batch-emails),
[scheduling](https://resend.com/docs/dashboard/emails/schedule-email),
[event payloads](https://resend.com/docs/webhooks/event-types), and
[SES Simple message attachments and headers](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_Message.html).

## Adding an endpoint

Register it with `apiRoute` from `convex/api/route.ts` in the resource's own module and call its `register…Routes` from `convex/api/http.ts`. The comment on `apiRoute` describes the handler contract.
