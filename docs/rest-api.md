# REST API

Machine-readable contract: [OpenAPI 3.1](../openapi/opensend.yaml); compatibility audit: [Resend parity](resend-parity.md).

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
| Idempotency | `Idempotency-Key` (1–256 characters) on any POST. The same key and body within 24 hours replays the first response; a different body is a 409. Concurrent requests receive `concurrent_idempotent_requests` (409). Resource creation and its wire response commit in the same transaction. A crash or logging failure after that commit cannot release the key. An uncommitted reservation can be retried after its 60-second lease; a stale worker is fenced before writing. |
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
| `GET /emails/receiving`, `GET /emails/receiving/{id}` | Received metadata and content. Full access required. |
| `GET /emails/receiving/{id}/attachments`, `GET /emails/receiving/{id}/attachments/{attachmentId}` | Paginated attachments and one attachment, with download URLs valid for one hour. Full access required. |
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
- Contact imports are documented below; segment metrics remain unavailable. Broadcast REST
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

## Receiving email

The [received-email API](https://resend.com/docs/api-reference/emails/retrieve-received-email)
returns `object: "email"`, `id`, `created_at`, `from`, `to`, `cc`, `bcc`,
`reply_to`, `subject`, `message_id`, `html`, `text`, `headers`, `attachments`,
`received_for`, `authentication`, and `raw`. Lists omit bodies, headers,
authentication and raw downloads. `received_for` comes from the `for` clauses
of Received headers; authentication verdicts come from SES. Retrieval defaults
to `html_format=data_uri` for inline images; `html_format=cid` preserves CID
references. HTML that would exceed 100 MiB after inlining retains CID references.

Attachment metadata uses `id`, `filename`, `size`, `content_type`,
`content_disposition`, and `content_id`. The attachment list and retrieval add
`download_url` and `expires_at`; retrieval also has `object: "attachment"`.
Attachment lists use the usual `limit`, `after`, and `before` parameters.
Downloads are signed for one hour and served without a redirect to permanent
storage URLs. Retention or team deletion revokes them immediately.

Stored MIME is parsed once after transfer to Convex storage. SNS retries and
parser reruns do not duplicate received rows or `email.received` webhooks.
The webhook follows [Resend's metadata-only payload](https://resend.com/docs/webhooks/emails/received):
`email_id`, `created_at`, `from`, `to`, `cc`, `bcc`, `received_for`, `message_id`,
`subject`, and attachment metadata (without size, bodies, headers or download URLs).
Bounce and complaint copies are kept as ordinary inbound mail; no sender or
subject heuristics discard messages.

The installation accepts raw MIME up to 40 MiB, with at most 100 attachments,
100 addresses per parsed address field, 512 distinct headers, 32 KiB of attachment
metadata, 32 KiB of envelope
metadata and 600 KiB of combined decoded HTML/text/headers. Messages that fail
parsing or exceed decoded limits remain visible with the raw MIME available;
their decoded body and attachments are empty. The parse reason is recorded for
operators. Received emails, bodies, attachments and raw files expire after 30
days; SNS deduplication tombstones remain. There is no attachment control in the
existing dashboard; attachment downloads are available through this API.

After deploying this version, the existing `migrations:backfillCounts` runner
also schedules parsing for previously stored inbound messages and backfills
received-email counts. No additional AWS permissions are required.

## Broadcasts

All broadcast endpoints require `full_access` and share the dashboard's team
permissions, pagination, logs and POST idempotency.

| Endpoint | Response |
| --- | --- |
| `POST /broadcasts` | `{ "object": "broadcast", "id" }` |
| `GET /broadcasts` | `{ "object": "list", "has_more", "data" }` |
| `GET /broadcasts/{id}` | Broadcast metadata and `html` / `text` |
| `PATCH /broadcasts/{id}` | `{ "object": "broadcast", "id" }` |
| `POST /broadcasts/{id}/send` | `{ "object": "broadcast", "id" }` |
| `POST /broadcasts/{id}/cancel` | `{ "object": "broadcast", "id" }` |
| `POST /broadcasts/{id}/duplicate` | `{ "object": "broadcast", "id" }` for the new draft |
| `DELETE /broadcasts/{id}` | `{ "object": "broadcast", "id", "deleted": true }` |

Create accepts `from`, `subject`, `html` or `text`, `name`, `preview_text`,
`reply_to` (one address or an array), `segment_id` (`audience_id` is an alias),
`topic_id`, `send`, and `scheduled_at`. Omit the segment, or set it to null, to
reach all contacts. `send: true` sends immediately or schedules when
`scheduled_at` is supplied. Send accepts `scheduled_at` in the same ISO or
natural-language format as emails, up to 30 days ahead. A scheduled broadcast
can be sent immediately by calling send without a schedule.

Drafts and canceled broadcasts can be edited. Other statuses allow a name change
only. Unsent drafts, canceled drafts and scheduled broadcasts can be deleted;
deleting a schedule cancels its delivery, matching
[Resend's deletion rule](https://resend.com/docs/api-reference/broadcasts/delete-broadcast).
Cancel works until audience resolution begins; messages already submitted to SES
cannot be recalled. The existing UI calls in-flight work `queued` (shown as
Sending). Completion is `sent` once all eligible recipient copies settle, or
`failed` if fan-out or a recipient's send fails. Delivery/bounce outcomes continue
updating the report after sending finishes.

Recipients are resolved in bounded pages when the send starts, with a creation
cutoff so newly added contacts do not extend an in-progress broadcast. Segment
membership and subscription preferences are checked as each page is processed.
Global opt-outs, topic opt-outs and team suppressions are excluded. Deleted
segments/topics refuse sending instead of widening the audience. Preferences and
removed targets are checked again before SES delivery. Each address receives at
most one email per broadcast; durable cursor checkpoints and recipient records
commit with the queued sends. Workflow journals rotate every 100 pages. All
copies use the standard email workpool, SES region rate limiter, tenant and
configuration set, tracking, events and webhooks (`data.broadcast_id`).

Merge tags support `contact.first_name`, `contact.last_name`, `contact.email`,
custom properties as `contact.<key>` or `contact.properties.<key>`, plus legacy
`FIRST_NAME`, `LAST_NAME`, `EMAIL` and bare property keys. Property defaults and
inline `|fallback` values are supported; HTML values are escaped.
`OPENSEND_UNSUBSCRIBE_URL` (`RESEND_UNSUBSCRIBE_URL` alias) and RFC 8058 headers
are generated for every recipient. One-click unsubscribes only the selected
topic, when present. Unsubscribes through these signed links are attributed once
to their broadcast; unrelated preference edits are not attributed to an old send.

Reports count unique per-recipient milestones using aggregates. Broadcast
recipient history and milestones remain after the ordinary 30-day email
retention and are removed with the team. Test sends use the current editor
export, one address and the normal email pipeline without changing the audience,
status or report. Broadcast CSV exports use the same server filters and cursor
pagination as the list.


## Automations

Every route requires `full_access`, checks team ownership and uses the shared
REST error/rate-limit/logging wrapper. POSTs support transactional idempotency.

| Endpoint | Success |
| --- | --- |
| `POST /automations` | 201 `{object:"automation",id}` |
| `GET /automations` | 200 `{object:"list",has_more,data}` |
| `GET /automations/{automation_id}` | 200 automation metadata, `steps`, `connections` |
| `PATCH /automations/{automation_id}` | 200 `{object:"automation",id}` |
| `DELETE /automations/{automation_id}` | 200 `{object:"automation",id,deleted:true}` |
| `POST /automations/{automation_id}/duplicate` | 201 `{object:"automation",id}` for a disabled copy |
| `POST /automations/{automation_id}/stop` | 200 `{object:"automation",id,status:"disabled"}` |
| `GET /automations/{automation_id}/runs` | 200 `{object:"list",has_more,data}` |
| `GET /automations/{automation_id}/runs/{run_id}` | 200 `{object:"automation_run",id,status,started_at,completed_at,created_at,steps}` |

Create accepts a nonempty `name`, optional `status` (`enabled` or `disabled`,
default disabled), `steps` and `connections`. These are the Resend wire objects:

```json
{
  "name": "Welcome",
  "steps": [
    {"key":"start","type":"trigger","config":{"event_name":"user.created"}},
    {"key":"pause","type":"delay","config":{"duration":"1 hour"}}
  ],
  "connections": [{"from":"start","to":"pause"}]
}
```

The supported step types are `trigger`, `send_email`, `delay`, `wait_for_event`,
`condition`, `contact_update`, `contact_delete`, and `add_to_segment`.
Connection types are `default`, `condition_met`, `condition_not_met`,
`event_received`, and `timeout`. The adapter translates into the dashboard's
validated graph; execution and webhook effects use the same runtime. Unknown
step types return 422 `validation_error` naming the type.

The shared runtime bounds definitions to one trigger plus 100 steps, 64 KiB and
12 levels of nested branches. Cycles, joins and arbitrary parallel fan-out are
rejected. Conditions accept a rule or a flat and/or rule group; nested mixed
groups and null comparisons are unsupported. Template variables support scalars
and `{var:"event.key"}` / `{var:"contact.key"}` references; subject overrides
and structured variables are unsupported. Wait steps require a timeout before
activation, at most 30 days; `filter_rule` is unsupported. Unsupported options
return explicit 422 errors.

PATCH requires name/status or both steps and connections. Disable an automation
in a separate request before editing its graph. Enabling uses the dashboard's
publish checks, including published templates and owned segments. Stop disables
new starts; existing snapshots finish, matching dashboard disable behavior.
Delete immediately fences execution and schedules bounded workflow cleanup.
Duplicate preserves the accepted definition and appends ` copy` to the name.

Both lists accept `limit`, `after`, and `before`. Automations accept a `status`
filter. Runs accept `running`, `completed`, `failed`, or `cancelled`, including
comma-separated or repeated statuses. Run detail orders steps by the execution
graph, preserves the original trigger key and returns nullable output/error and
completion timestamps. Errors contain `{message}`. A foreign id or a run under
the wrong parent returns 404 `not_found`.

## Contact imports

`POST /contacts/imports` accepts `multipart/form-data`, as the Resend SDK sends:
a CSV `file`, optional JSON-encoded `column_map`, `segments`, and `topics`, and
`on_conflict` (`upsert` or `skip`). The current docs' default is `upsert`.
Column maps use `email`, `first_name`, `last_name`, `unsubscribed`, and
`properties:{key:{column,type}}`; absent maps match the standard column names.
Custom property types are `string` and `number`; boolean properties are
unsupported by the shared contact model. New mapped property definitions are
created in the same transaction as the job. Segment entries use `{id}`, topic
entries use `{id,subscription:"opt_in"|"opt_out"}`.

```sh
curl "$OPENSEND_API_URL/contacts/imports" \
  -H "Authorization: Bearer $OPENSEND_API_KEY" \
  -H "Idempotency-Key: contacts-september" \
  -F 'file=@contacts.csv;type=text/csv' \
  -F 'column_map={"email":"Email","first_name":"First Name"}' \
  -F 'on_conflict=upsert'
```

Success is 201 `{object:"contact_import",id}`. Multipart replay hashes the
sorted decoded form fields, including CSV contents, so fresh boundary strings
do not create duplicate jobs. The request limit is 1 MiB; each durable import
accepts 1–500 rows and at most 500 KB of parsed job data, plus up to 100 segment
and 100 topic references. Larger files must be split into smaller imports.
Malformed CSV/maps and unsupported property types return 422; malformed
multipart returns 400. Neither URLs nor inline JSON contact lists are accepted.

`GET /contacts/imports` uses standard id pagination and an optional `status`
filter (`queued`, `in_progress`, `completed`, `failed`). Jobs enter in_progress
immediately. Scans cap at 4 MiB, so pages may be shorter than the requested limit.
`GET /contacts/imports/{id}` returns the same item shape:
`{object:"contact_import",id,status,created_at,completed_at,counts}` with counts
`{total,created,updated,skipped,failed}`. Total is rows processed so far.
Completion is nullable while processing. Invalid rows increment failed rather
than skipped; existing contacts under skip increment skipped. Legacy jobs have
no stored completion timestamp or separate failure count. Private diagnostic
text and CSV contents are not returned. Completed/failed jobs expire after
seven days, following existing import retention.

Processing reuses dashboard CSV jobs, including per-contact subtransactions and
bounded scheduling. All contact creation/update and topic changes suppress
contact webhooks, as CSV imports do in Resend. Every referenced segment/topic
must belong to the caller's team. After upgrade, `migrations:backfillCounts`
also backfills the import-job counter; no deployment is performed by this lane.

## Email metrics

`GET /emails/metrics` requires `full_access`. It accepts ISO `start_date` and
`end_date`, IANA `timezone` (default UTC), `granularity` (`hourly`, `daily`,
`weekly`, `monthly`, default daily), `metrics`, `dimensions`, and `domain_id`.
List parameters accept commas, repeated parameters or both. With no dates,
it covers today and the previous six days. Date-only end dates include the
whole date; future end dates clamp to now.

The response is `{object:"metrics",start_date,end_date,metrics,dimensions,
granularity,totals,data?}`. With no dimensions, only totals are returned.
Supported dimensions are `period` and `domain`, alone or together. Domain rows
include `domain_id` and `domain_name`; period rows are chronological. Timezone
bucketing handles DST and non-hour offsets. Rates are percentages, recomputed
from total counts rather than averaged across periods.

Supported metrics (also the default selection) are `received`, `sent`,
`delivered`, `delivery_delayed`, `failed`, `suppressed`, `bounced`,
`bounced_transient`, `bounced_permanent`, `bounced_undetermined`, `complained`,
`unique_opened`, `unique_clicked`, `delivery_rate`, `open_rate`, `click_rate`,
`bounce_rate`, and `complaint_rate`. Received counts retained email rows; other
counts use retained unique milestones grouped by email creation time.

Queries use the existing aggregates, whose precision is 15 minutes. Date-time
boundaries round outward to those buckets. A query supports at most 31 total
domain-period spans and a one-year range; excess requests return 422
`validation_error`. Select fewer domains, a coarser granularity or shorter
range. Domain filters accept at most 100 ids and return 404 for foreign ids.

Email/broadcast dimensions and filters, repeat `opened`/`clicked` events,
`unsubscribed` and `unsubscribe_rate` return 422. Historical aggregates do not
retain those dimensions/events; the API does not invent zero values for them.
These are documented parity gaps, alongside self-hosted range and precision
limits. No raw unbounded event scan is used.
