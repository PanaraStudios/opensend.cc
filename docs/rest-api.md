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
REST template variable definitions support string and number types, enforce
Resend's reserved names, and require a value or fallback at send time. Existing
editor merge tags remain supported.

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
SES event processing. Dashboard metrics remain a separate lane. Template and broadcast editor test
sends use the same real sending pipeline.

References: [send](https://resend.com/docs/api-reference/emails/send-email),
[batch](https://resend.com/docs/api-reference/emails/send-batch-emails),
[scheduling](https://resend.com/docs/dashboard/emails/schedule-email),
[event payloads](https://resend.com/docs/webhooks/event-types), and
[SES Simple message attachments and headers](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_Message.html).

## Contacts, segments, topics and properties

All endpoints in this section require full access. A plain team member may create
that key and use these endpoints. Foreign resource ids return 404 without exposing
the owning team; invalid or foreign pagination anchors return 422. Contact writes
share the dashboard helpers and emit `contact.created`, `contact.updated`, and
`contact.deleted` through the event outbox. No-op writes do not emit updates.

| Endpoint | Body / result |
| --- | --- |
| `POST /contacts` | Required `email`; optional `first_name`, `last_name`, `unsubscribed`, `properties`, `segments: [{ id }]`, `topics: [{ id, subscription }]`. Returns `{ object: "contact", id }`. |
| `GET /contacts` | Contact summaries; optional `segment_id` plus the shared pagination parameters. |
| `GET /contacts/{idOrEmail}` | Contact summary plus `object: "contact"` and `properties: { key: { value, type } }`. Values use property defaults when unset. |
| `PATCH /contacts/{idOrEmail}` | Optional names, `unsubscribed`, `properties`; `null` clears a property. Returns `{ object: "contact", id }`. |
| `DELETE /contacts/{idOrEmail}` | Returns `{ object: "contact", contact: id, deleted: true }`, matching Resend's documented `contact` field. |
| `POST /segments` | Required `name`; returns `{ object: "segment", id }`. |
| `GET /segments`, `GET /segments/{id}` | Paginated summaries / one segment: `id`, `name`, `created_at`; retrieval also has `object: "segment"`. |
| `PATCH /segments/{id}` | Required `name`; returns `{ object: "segment", id }`. |
| `DELETE /segments/{id}` | Returns `{ object: "segment", id, deleted: true }`. Contacts remain; memberships are cleaned in batches. |
| `GET /segments/{id}/contacts` | Paginated contact summaries in the segment. |
| `POST /contacts/{idOrEmail}/segments/{segmentId}` | Adds membership; returns `{ id: segmentId }`. Repeated adds are harmless. |
| `DELETE /contacts/{idOrEmail}/segments/{segmentId}` | Returns `{ object: "contact_segment", id: contactId, audienceId: segmentId, deleted: true }`, including Resend's documented legacy `audienceId` field. |
| `GET /contacts/{idOrEmail}/segments` | Paginated segment summaries for this contact. |
| `POST /topics` | Required `name`, `default_subscription: "opt_in" | "opt_out"`; optional `description`, `visibility: "public" | "private"` (default private). Returns `{ object: "topic", id }`. |
| `GET /topics`, `GET /topics/{id}` | Paginated summaries / one topic: `id`, `name`, `description`, `default_subscription`, `visibility`, `created_at`; retrieval also has `object: "topic"`. |
| `PATCH /topics/{id}` | Optional `name`, `description`, `visibility`; default subscription is immutable. Returns `{ object: "topic", id }`. |
| `DELETE /topics/{id}` | Returns `{ object: "topic", id, deleted: true }`; subscriptions are cleaned in batches. |
| `GET /contacts/{idOrEmail}/topics` | Paginated effective topic subscriptions: `id`, `name`, `description`, `subscription: "opt_in" | "opt_out"`. An explicit choice overrides the topic default. |
| `PATCH /contacts/{idOrEmail}/topics` | Required `topics: [{ id, subscription: "opt_in" | "opt_out" }]`; returns `{ object: "contact_topics", id: contactId }`. Emits `contact.updated` when a choice changes, as does the dashboard. |
| `POST /contact-properties` | Required `key`, `type: "string" | "number"`; optional typed `fallback_value`. Returns `{ object: "contact_property", id }`. |
| `GET /contact-properties`, `GET /contact-properties/{id}` | Paginated summaries / one property: `id`, `key`, `type`, `fallback_value`, `created_at`; retrieval also has `object: "contact_property"`. |
| `PATCH /contact-properties/{id}` | Optional typed `fallback_value`; key and type are immutable. Returns `{ object: "contact_property", id }`. |
| `DELETE /contact-properties/{id}` | Returns `{ object: "contact_property", id, deleted: true }`. Hides the property immediately and strips contact values in background batches. The key stays reserved until cleanup finishes. |

Contact summaries contain `id`, `email`, `first_name`, `last_name`, `created_at`,
and `unsubscribed`. Email lookup is case-insensitive; URL-encode addresses in paths.
New contacts and their memberships/subscriptions are committed atomically.

Audience compatibility details:

- All lists default to 20 rows and cap pages at 100, including lists for which
  Resend documents returning everything when `limit` is omitted. Use `has_more`.
- Segment-contact pagination follows membership creation time. Contact-segment
  pagination follows segment creation time. Both are newest first.
- Creating an existing email merges supplied fields and segment memberships,
  following the dashboard's upsert behavior. It does not replace the contact.
- Only string and number properties are supported; boolean values are rejected.
  Number values/fallbacks must be JSON numbers; responses return numbers. Empty
  property strings clear the value and use its default, like the dashboard.
- Property keys follow the existing dashboard normalization (lowercase) and
  reserved-key validation. Teams have at most 100 properties, 500 segments and
  100 topics. Create-contact relationship arrays share those limits.
- Resend's wire `default_subscription: "opt_in"` means subscribed by default;
  `"opt_out"` means unsubscribed. The existing dashboard names the consent mode
  inversely (its "Opt-out" subscribes new contacts). The API translates both ways
  and uses the shared effective-subscription helper, preserving the UI and actual
  recipient behavior. See [Resend's topic semantics](https://resend.com/blog/unsubscribe-topics).
- Topic API names are limited to 50 characters and descriptions to 200, as in
  Resend. The existing dashboard accepts longer values, which retrieval preserves.
- Contact imports and segment metrics are outside this lane. Broadcast REST
  endpoints remain wave 5.

References: [contacts](https://resend.com/docs/api-reference/contacts/create-contact),
[contact retrieval](https://resend.com/docs/api-reference/contacts/get-contact),
[segments](https://resend.com/docs/api-reference/segments/create-segment),
[topics](https://resend.com/docs/api-reference/topics/create-topic),
[contact subscriptions](https://resend.com/docs/api-reference/contacts/update-contact-topics),
and [properties](https://resend.com/docs/api-reference/contact-properties/create-contact-property).

## Templates

All template-management endpoints require full access. Sending-access credentials
can use a published template through `POST /emails`, but cannot manage templates.

| Endpoint | Body / result |
| --- | --- |
| `POST /templates` | Required `name`, `html`; optional `alias`, `from`, `subject`, `reply_to` (string or array), `text`, `variables`. Returns `{ object: "template", id }`. Creates a draft. |
| `GET /templates` | Shared cursor pagination. Summaries contain `id`, `name`, `alias`, `status`, `created_at`, `updated_at`, `published_at`. |
| `GET /templates/{idOrAlias}` | Current draft with summary fields, `object: "template"`, `current_version_id`, `from`, `subject`, `reply_to`, `html`, `text`, `variables`, `has_unpublished_versions`. |
| `PATCH /templates/{idOrAlias}` | Any create field is optional. Edits only the draft; published sends keep their previous snapshot. Returns `{ object: "template", id }`. |
| `DELETE /templates/{idOrAlias}` | Deletes the draft and published snapshot; returns `{ object: "template", id, deleted: true }`. |
| `POST /templates/{idOrAlias}/publish` | Copies the current draft to the published snapshot; returns `{ object: "template", id }`. Nonempty HTML is required. |
| `POST /templates/{idOrAlias}/duplicate` | Copies the current draft into a new draft, with a unique alias and a ` copy` name suffix. Returns `{ object: "template", id: newId }`. |

`variables` contains at most 50 `{ key, type: "string" | "number", fallback_value? }`
entries. Fallbacks must match their declared type. Keys are unique identifiers,
up to 50 characters, and may not be `FIRST_NAME`, `LAST_NAME`, `EMAIL`,
`RESEND_UNSUBSCRIBE_URL`, `contact`, or `this`. Sending validates supplied types,
uses defaults for missing values, and refuses required variables without defaults.
Numbers (including zero) render as text; HTML substitutions are escaped.

Template compatibility details:

- HTML and optional plain text each have a 256 KiB limit. HTML without explicit
  text generates plain text; explicit `text: ""` keeps an empty text part.
- The existing editor's inline `{{{key|fallback}}}` tags are inferred as variables.
  Explicit API definitions override inferred defaults and preserve their types
  across editing, publishing and duplication. Legacy editor reserved-name tags
  remain readable; reserved names are rejected in explicit variable definitions.
- There is one mutable draft and one published snapshot, not a version-history
  table. `current_version_id` is the draft document id, stable across edits.
  Variable entries have `key`, `type`, and `fallback_value`, without Resend's
  per-variable ids and creation/update timestamps. No version-history endpoints
  are exposed.
- An omitted alias is generated using the dashboard's alias rules. Aliases remain
  unique within the team and follow the existing dashboard rename semantics.
- The wire API accepts HTML; the Node SDK is responsible for rendering `react`.

References: [create](https://resend.com/docs/api-reference/templates/create-template),
[retrieve](https://resend.com/docs/api-reference/templates/get-template),
[update](https://resend.com/docs/api-reference/templates/update-template),
[publish](https://resend.com/docs/api-reference/templates/publish-template),
and [duplicate](https://resend.com/docs/api-reference/templates/duplicate-template).

## Editor test emails

The existing template and broadcast test dialogs now invoke `testEmails.send`.
They keep their single-recipient field, `[Test]` subject prefix and existing
success/error presentation. The backend requires team write permission and a
verified sender domain, then uses `emails.createEmail`: suppression checks,
queueing, SES tenant/configuration-set binding, email list entries, and normal
email events all follow the real sending pipeline. Tests never create contacts or
change audience subscriptions. Custom reply-to is omitted, consistent with
[Resend's broadcast test mode](https://resend.com/docs/dashboard/broadcasts/editor#testing--sending).

Templates test the editor's current exported HTML and subject, with the draft's
variable definitions and optional text. Publication is unnecessary. Variables
use inline or declared defaults; missing required custom values fail. The current
UI has no variable-value input, so adding Resend's test-variable form is deferred.
The single-recipient limit and `[Test]` prefix preserve this dashboard's contract;
Resend's documentation does not specify a numeric recipient cap or subject-prefix
contract for these editor tests. No additional recipients or controls were added.

Wave 5 seam: broadcasts still live in the demo store. The dialog passes its
current HTML (at most 256 KiB), subject and sender to the backend; `renderEmail`
fills inline fallbacks and derives text. It does not resolve a saved broadcast id,
expand an audience, or mark a broadcast sent. Template ids are checked against the
active team. A missing verified domain fails rather than using a shared sender.

## Adding an endpoint

Register it with `apiRoute` from `convex/api/route.ts` in the resource's own module and call its `register…Routes` from `convex/api/http.ts`. The comment on `apiRoute` describes the handler contract.

### SMTP gateway bridge

`POST /smtp/auth` (empty body) validates an `os_` sending/full-access bearer key
and the team's SMTP enablement. `POST /smtp/emails` takes the same JSON fields
as `POST /emails` and returns `{ "id": "…" }`. These endpoints are for the
SMTP gateway and authenticate with the client's key, without an admin secret.
They share REST rate limiting, domain restrictions and idempotency; OAuth is
not accepted for SMTP. They record `source: smtp` API logs. Enablement is
checked before idempotent replay and again in the queuing transaction. See
[self-hosting](self-hosting.md#optional-smtp-submission-service) for TLS, limits,
and deployment configuration.
