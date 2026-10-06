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
| Lists | `limit` (1–100, default 20) with `after` or `before` an id, newest first with an id tie-break for equal timestamps; responses are `{ "object": "list", "has_more", "data" }`. |
| Bodies | JSON, up to 1 MB. |
| CORS | None: the API is for servers, like Resend's. |
| Logs | Every request that authenticates to a team is logged (Logs in the dashboard, `GET /logs`), failures included, with `authorization` and cookies redacted and bodies cut at 64 KB. Logs are kept 30 days. |

## Endpoints

| Endpoint | Notes |
| --- | --- |
| `POST /api-keys`, `GET /api-keys`, `PATCH /api-keys/{id}`, `DELETE /api-keys/{id}` | As Resend. |
| `POST /domains`, `GET /domains`, `GET /domains/{id}`, `PATCH /domains/{id}`, `POST /domains/{id}/verify`, `DELETE /domains/{id}` | As Resend, backed by the same logic as the dashboard. |
| `GET /logs`, `GET /logs/{id}` | As Resend. |
| `POST /emails`, `POST /emails/batch` | Queues transactional mail through the team's SES tenant. Sending-access or full-access credentials. Returns `{ "id" }` or `{ "data": [{ "id" }] }`. |
| `GET /emails/receiving`, `GET /emails/receiving/{id}` | Received metadata and content. Full access required. |
| `GET /emails/receiving/{id}/attachments`, `GET /emails/receiving/{id}/attachments/{attachmentId}` | Paginated attachments and one attachment, with download URLs valid for one hour. Full access required. |
| `GET /emails`, `GET /emails/{id}` | Sent-email metadata and, on retrieval, the HTML and plain text. Full access required. |
| `PATCH /emails/{id}`, `POST /emails/{id}/cancel` | Reschedule with `scheduled_at`, or cancel a scheduled email. Full access required. Returns `{ "object": "email", "id" }`. |
| `POST /events`, `GET /events`, `GET /events/{id}`, `PATCH /events/{id}`, `DELETE /events/{id}` | Custom event definitions, as Resend. `{id}` is the event's id or its name. Backed by the same rules as the dashboard's Events page. |
| `GET /events/catalog` | Searchable catalog, scope `events:read`: `{object:"event_catalog", has_more, next_cursor, data}`. Optional `limit` (custom definitions per page, 1–100, default 20), `after` (previous `next_cursor`), `search`. System events are included on the first page; later pages contain custom definitions. Keep search unchanged when continuing. |
| `POST /events/send` | Sends a custom event for one contact, as Resend: `event`, exactly one of `contact_id` or `email`, and an optional `payload` object. Answers 202 `{ "object": "event", "event" }`. |

## Deviations from Resend

- Ids are Convex document ids, not UUIDs.
- Domains: `region` defaults to the installation's default region. New domains accept `tls` and `capabilities` at creation; omitted values default to opportunistic TLS, sending on and receiving off. The shared provisioning workflow applies the requested settings. `open_tracking`, `click_tracking` and `tracking_subdomain` work as in Resend, on create and `PATCH`: the subdomain can change but not be removed, and tracking starts once its `Tracking` CNAME record is verified. Tracked links use HTTP (SES's HTTP redirect option); HTTPS tracking needs a CDN and certificate Opensend does not create. Turning receiving on in a region SES does not receive mail in is a 422. `POST /domains/{id}/verify` retries a failed setup or starts a DNS check; checks are limited to one per domain every 10 seconds. Deleting a domain queues its removal from AWS.
- Events: teams can define at most 10,000 custom event types; additional creates and automation auto-registration return `422 validation_error`, while existing definitions above the cap are retained. The maintained counter is updated transactionally on creation and deletion. Names starting with `opensend:` (Resend: `resend:`) are reserved. A schema has at most 50 properties and property names use letters, numbers and underscores. Like Resend, every endpoint needs a full-access key: a sending key may only send emails.
- `POST /events/send`: a defined event's payload must carry every schema property with its type (`date` is an ISO 8601 string), or the send is a 422 naming each problem; values are not coerced. An event nobody defined is accepted as sent and is not defined by it. An `email` with no contact yet is accepted, and the contact is created when an automation run starts, as Resend does; an unknown `contact_id` is a 404. Payloads are limited to 64 KB and 32 levels of nesting, and object keys must be printable ASCII not starting with `$` (a Convex storage rule). Sent events are kept 30 days. There is no client-supplied event id; use `Idempotency-Key` to make a retry safe. Sent events are not delivered to webhooks (Resend's webhooks carry only its own event types).
- Requests that fail before a team is known (no key, an unknown key) are answered but not logged.

## Sending email

`POST /emails` accepts `from`, `to`, `cc`, `bcc`, `reply_to`, `subject`, `html`,
`text`, `headers`, `attachments`, `tags`, `scheduled_at`, and
`topic_id`, and `template: { id, variables }`. Address fields accept a string or array, except
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
Batch requests accept 1–100 messages, scheduling and templates, but no attachments.
The default `x-batch-validation: strict` validates and commits the entire batch
atomically. `permissive` commits valid items and returns `data` with successful
ids plus `errors: [{ index, message }]` using original zero-based positions.
The errors array is present even when empty. Changing this header while reusing
an idempotency key is a conflict.

Attachments accept base64 `content`, `filename`, optional `content_type`, and
optional `content_id` for inline images. Alternatively supply a public HTTPS
`path`; the filename can be inferred from its URL. Downloads use DNS-pinned
public addresses, a 10-second timeout per fetch, and at most three redirects,
each revalidated. Local/private/HTTP targets are refused to protect the host. Unsupported SES file extensions,
invalid MIME metadata, and malformed base64 also return 422. Base64 attachments
are capped at 40 MiB in aggregate. The send endpoint allows a larger JSON body
than the default endpoint limit, but the deployed Convex HTTP/proxy limit can be
lower. Email HTML, text and headers together are capped at 900,000 UTF-8 bytes
to fit one Convex content document. Custom headers cannot override fields SES
builds itself. There are at most 50 headers and 48 user tags (two SES tags are
reserved for `opensend_email` and `opensend_team`).
`topic_id` checks every to/cc/bcc address just before delivery: an explicit
contact choice overrides the topic default; global contact opt-outs also apply.
Noncontacts use the topic default. Opted-out addresses receive failed events
and are removed from delivery; if all recipients opt out the email fails.
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
- REST property keys preserve alphanumeric/underscore spelling (1–50 characters);
  reserved contact fields remain unavailable. String fallbacks preserve whitespace
  and empty strings on both create and update. The dashboard keeps its normalization. Teams have at most 100 properties and
  100 topics, and any number of segments. Create-contact `topics` holds at most 100
  items and `segments` at most 1,000; memberships past the first 200 join moments
  later in the background. `GET /contacts/{id}/segments` pages by membership, newest
  joined first, and its `created_at` is when the contact joined (as in Resend).
  Contact webhooks' `segment_ids` list at most 100 segments, most recently joined first.
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
  table. `current_version_id` identifies the draft revision, changes on edits and is
  preserved when that revision is published.
  Variable entries include `id`, `key`, `type`, `fallback_value`, `created_at`,
  and `updated_at`. Variable ids and timestamps are persisted across unrelated edits; changing
  a variable changes only its updated timestamp, and readding a removed key
  creates a new id. Legacy templates fall back to template timestamps until
  edited; past variable lifetimes cannot be reconstructed. No version-history
  endpoints are exposed.
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
references. Received `created_at` uses ISO 8601. An individual image over 6 MiB
or projected inlined HTML over 8 MiB retains CID references to fit Convex limits.

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
| `POST /broadcasts/{id}/send` | `{ "id" }` |
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

Reports retain unique per-recipient milestones and actual open/click occurrence
counts. Recipient history, milestones and clicked-link details expire 30 days
after the broadcast settles; summary statistics remain on the broadcast. Test sends use the current editor
export, one address and the normal email pipeline without changing the audience,
status or report. Broadcast CSV exports use the same server filters and cursor
pagination as the list.

## Webhooks

All ten webhook routes require full access. They use the dashboard's shared
validation, subscription, rotation, deletion and replay helpers. Webhook URLs
must be HTTPS public hosts; delivery resolves public addresses safely and does
not follow redirects. Each team can register 100 webhooks.

| Endpoint | Success | Body / response |
| --- | --- | --- |
| `POST /webhooks` | 201 | `{endpoint, events}` → `{object:"webhook", id, signing_secret}` |
| `GET /webhooks` | 200 | `{object:"list", has_more, data:[{id, endpoint, events, status, created_at}]}` |
| `GET /webhooks/{webhook_id}` | 200 | `{object:"webhook", id, endpoint, events, status, created_at, signing_secret}` |
| `PATCH /webhooks/{webhook_id}` | 200 | Optional `endpoint`, `events`, `status` (`enabled`/`disabled`) → `{object:"webhook", id}` |
| `DELETE /webhooks/{webhook_id}` | 200 | `{object:"webhook", id, deleted:true}` |
| `POST /webhooks/{webhook_id}/signing-secret/rotate` | 200 | `{object:"webhook", id, signing_secret}` |
| `GET /webhooks/{webhook_id}/events` | 200 | `{object:"list", has_more, data:[{id, type, created_at, status}]}` |
| `GET /webhooks/{webhook_id}/events/{event_id}` | 200 | `{object:"webhook_event", id, type, created_at, status, next_attempt_at, payload}` |
| `POST /webhooks/{webhook_id}/events/{event_id}/replay` | 200 | `{object:"webhook_event", id}` with the original event id |
| `GET /webhooks/{webhook_id}/events/{event_id}/attempts` | 200 | `{object:"list", has_more, data:[{id, http_status_code, response, sent_at}]}` |

The webhook list supports `limit`, `after` and `before`. Event and attempt lists
support `limit` and `after` only, reject `before`, and default to 20 (maximum 100).
IDs are opaque; an event must belong to the webhook in the URL. An inaccessible
or deleted resource returns 404 `not_found`. Event states are `pending`,
`attempting`, `success` and `failed`; event and attempt timestamps are ISO UTC.

Create, rotation (including a replay of that POST's `Idempotency-Key`) and
`GET /webhooks/{webhook_id}` return the secret, as the
[Resend GET response](https://resend.com/docs/api-reference/webhooks/get-webhook.md)
does; the list omits it. Secrets remain encrypted in webhook storage and are redacted from request logs.
Rotation signs each new attempt with both the new and immediately preceding
secret for 24 hours, using space-separated Svix signatures. After that window,
only the new secret signs; repeated rotations replace the preceding key.

Replay queues a single extra attempt with the same `svix-id`, leaves automatic
retry scheduling intact, and requires an enabled webhook (otherwise 422
`validation_error`). Replays share the original event's attempt history and do
not add another item to the REST event list. All POST writes commit their
idempotency response with their rows. Deletion stops delivery immediately and
purges delivery and attempt records in bounded background batches.

Attempt history is recorded from wave 8B onward. Older versions retained only
the latest result, so earlier individual attempts cannot be reconstructed.
History expires after 90 days; each recorded response is limited to 4 KiB.
The existing `migrations:backfillCounts` runner includes the new attempt counter.
No backend deployment or migration is run by this lane.

## Suppressions

All six suppression routes require full access. Sending-only keys receive 401
`restricted_api_key`. The dashboard, REST API and SES projection share storage
helpers and emit `suppression.added` / `suppression.removed` through the outbox.
These event types can be subscribed to through REST; this wave keeps the
existing dashboard subscription controls unchanged.

| Endpoint | Success | Body / response |
| --- | --- | --- |
| `POST /suppressions` | 201 | `{email}` → `{object:"suppression", id}` |
| `GET /suppressions` | 200 | `{object:"list", has_more, data:[{id, email, origin, source_id, created_at}]}` |
| `POST /suppressions/batch/add` | 201 | `{emails:[...]}` → `{data:[{object:"suppression", id}]}` |
| `POST /suppressions/batch/remove` | 200 | `{emails:[...]}` or `{ids:[...]}` → `{data:[{object:"suppression", id, deleted:true}]}` |
| `GET /suppressions/{suppression}` | 200 | `{object:"suppression", id, email, origin, source_id, created_at}` |
| `DELETE /suppressions/{suppression}` | 200 | `{object:"suppression", id, deleted:true}` |

`{suppression}` accepts an id or URL-encoded email. Addresses are trimmed and
lowercased; manual creation sets `origin:"manual"`. Automatic SES reasons map
`bounced` to `bounce` and `complained` to `complaint`. List accepts the usual
`limit`/`after`/`before` parameters and `origin=bounce|complaint|manual`.
`source_id` is the email that caused an automatic suppression, or null for a
manual entry. Automatic records created before wave 8B also return null because
those versions did not retain the source id.

Batches accept 1–100 entries, return results in input order, and commit atomically.
Batch removal requires exactly one of `emails` and `ids`; a missing or foreign
entry refuses the whole batch with 404. Duplicate normalized addresses share
one suppression id; duplicate removals delete it once. Repeating a POST with the
same idempotency key returns the original status and body without emitting
another event. Removing a bounce/complaint schedules the existing SES tenant
suppression cleanup for each provisioned region, so SES can deliver again.

Suppression webhook data contains `id`, `email`, `origin`, `source_id`, and ISO
`created_at` inside the standard `{type, created_at, data}` envelope. Repeated
adds of an existing address do not emit duplicate `suppression.added` events.

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
accepts 1–500 rows and at most 500 KB of parsed job data, plus up to 1,000 segment
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

## Compatibility additions (wave 8A)

Resource creation returns **201** for domains, API keys, contacts, segments,
audiences, topics, contact properties, templates and broadcasts, including
broadcast duplication. Email send/batch return **200**; event create/send remain
**201/202**. Idempotency replay preserves these exact statuses and bodies.
API-key creation returns only `{id, token}`. `PATCH /api-keys/{id}` requires
`name` and returns `{object:"api_key",id}` using the dashboard’s shared update helper.

`POST /audiences`, `GET /audiences`, `GET /audiences/{id}` and
`DELETE /audiences/{id}` alias the same segment records, with `object:"audience"`
on singular responses. Lists use the standard list envelope; deleting an audience
preserves contacts. The modern SDK’s `audiences` alias already calls `/segments`.
Deprecated `audience_id` on contact creation assigns that segment when `segments`
is omitted. Contact GET/PATCH paths accept ids or URL-encoded email addresses,
case-insensitively. PATCH `first_name: null` or `last_name: null` clears the name;
`email` is the SDK’s path selector, not an address-change operation.

`GET /emails/{id}/attachments` and `GET /emails/{id}/attachments/{attachmentId}`
return stored outbound files with stable opaque ids, filename, size, content type,
disposition, nullable content id, a signed `download_url`, and ISO `expires_at`.
Only singular retrieval includes `object:"attachment"`; lists use the shared list
envelope. Downloads expire after one hour and recheck retention and team removal;
they never redirect to permanent storage URLs. Unknown/foreign parents or file ids
return 404. A single-file request ignores list parameters.

`GET /oauth/grants` and `DELETE /oauth/grants/{id}` now use the shared REST wrapper,
accept full-access API keys or OAuth tokens, and log/rate-limit requests normally.
List rows contain `id`, `client_id`, `scopes`, `resource` (null for this installation),
`created_at`, nullable `revoked_at`/`revoked_reason`, and `client: {name,logo_uri}`.
Lists include revoked rows. Revocation returns
`{object:"oauth_grant",id,revoked_at,revoked_reason:"revoked_from_api"}`;
foreign, unknown or already-revoked grants return 404. All tokens under the grant
immediately fail validation. Historical revocations and epoch invalidations do not
have reconstructed timestamps/reasons.

`GET /broadcasts/{id}/recipients` requires `type`:
`sent`, `delivered`, `opened`, `clicked`, `bounced`, `complained`, `unsubscribed`,
or `suppressed`. `email` filters by substring. `bounce_type` accepts `permanent`,
`transient`, or `undetermined` only with `type=bounced`. Results include an opaque
cursor `id`, nullable `contact_id`, and `email`; opened/clicked add `count`, clicked
adds `clicked_links: [{url,clicks}]`, and bounced adds `bounce_type`.

`GET /broadcasts/{id}/clicked-links` returns `id`, `url`, `clicks` and
`unique_clicks`, ordered by total clicks descending. Unique clicks count distinct
recipient messages; the broadcast pipeline creates at most one message per address.
Both reports support limit/after/before, enforce full access and team ownership,
and use id tie-breaks. Lists of broadcasts now include `topic_id`; reply-to fields
on broadcast/template retrieval are arrays or null.

Broadcast report tables are maintained transactionally from the same email events
that drive dashboard metrics. After deployment, the existing
`migrations:backfillCounts` runner backfills retained events and the new aggregates;
re-running it is safe. Events already removed by retention cannot be reconstructed.
No new AWS permissions are required. Log responses return null for unknown user
agents and preserve the original JSON body shape (including batch arrays), subject
to redaction and the existing 64 KiB truncation.

### Share an email

`POST /emails/{email_id}/share` requires a full-access key and accepts either a
sent or received email ID belonging to its team. The optional JSON body is
`{"expires_in":"2 hours"}`. Durations such as `10m`, `2 hours`, and `1 day` are
supported; the default and maximum are 48 hours. Nonpositive, invalid, or longer
durations return `422 validation_error`; foreign or missing IDs return
`404 not_found`. A sending-only key returns `401 restricted_api_key`.

Success is `200 {"object":"email","id":"…","url":"https://your-dashboard/shared?token=…"}`.
The route supports `Idempotency-Key` and replays the same link without extending
its expiry. The cache keeps a nonce; a domain-separated HMAC using the existing
`BETTER_AUTH_SECRET` reconstructs the bearer at the wire. Only its SHA-256 hash
is stored in `emailShares`, and share responses are redacted in API logs.
Rotating that secret during the 24-hour idempotency window prevents replayed
links from matching their original hashes; existing issued links still work.

The public page requires no account, is not indexed or cached, and uses the same
sandboxed HTML preview as the dashboard. It shows subject, From, To, Cc, Reply-To,
date, body, and attachment names/types/sizes. It excludes Bcc, arbitrary headers,
raw MIME, download URLs, events, and internal identifiers. Links become invalid
at expiry or when the email or team is deleted/retired; expired tokens are pruned
hourly in bounded batches. Creating another link does not revoke previous links.
Dashboard members can create and copy links from **Share email** in either email
detail menu.

### Domain claims

`POST /domains/claim` accepts `name`, optional `region`, `custom_return_path`
(default `send`), `open_tracking`, `click_tracking`, and `tracking_subdomain`, as
`resend.domains.claims.create()` sends them. It returns 201 for a new claim or
200 when resuming that team's existing claim (retaining its original settings).
`GET /domains/{domain_id}/claim` returns the latest claim for the placeholder
id; `POST /domains/{domain_id}/claim/verify` returns 200 and starts asynchronous
DNS verification. All three require full-access keys; foreign ids return 404.
Both POSTs support `Idempotency-Key`.

The response is `{ object: "domain_claim", id, name, status, domain_id, region,
record: { type: "TXT", name, value, ttl: "Auto" }, blocked_reason, failure_reason,
created_at, expires_at }`. Publish the returned `opensend-domain-verification=…`
TXT value at the domain apex. The random token is case-sensitive; DNS string
chunks are joined before comparison. Only server-side DNS lookups prove ownership.
A placeholder is listed on the claiming team but cannot send, receive, adopt an
SES identity, or run ordinary domain verification. `POST /domains` returns
403 `validation_error` with `The <name> domain has been registered already`
when another team reserves the name, including across regions.

Claims wait in `pending`, pass through `verified` while SES transfers the domain,
and reach `completed` after the new team's SES provisioning succeeds. Queued or
scheduled mail blocks with `pending_scheduled_emails`; an active removal,
provisioning/refresh operation, competing transfer, or imported SES identity
blocks with `recent_owner_activity`. `failure_reason` explains what to resolve.
An imported identity must be released by its owner: normal deletion restores its
external configuration, which a claim must not silently adopt or destroy.
There is no time-based owner-activity/grace-period heuristic. Blocked claims can
retry verification after the condition clears.

Pending/blocked claims expire after seven days, matching Resend's documented
window. Creating again supersedes the expired placeholder with a new token.
Deleting a pending/blocked/expired placeholder cancels its claim; a verified
transfer cannot be canceled mid-operation. Once TXT proof is accepted, expiry
no longer interrupts the transfer. An AWS failure leaves it `verified` with a
`failure_reason`; verify again retries the failed step without releasing its lock.

On transfer the old team's existing removal workflow detaches the tenant,
removes receipt rules and the owned identity, and emits `domain.deleted`. Only
then does the new team's ordinary provisioning run, producing fresh DKIM records
and `domain.updated` (its placeholder already emitted `domain.created`). Fetch
`GET /domains/{domain_id}`, add those new records, and run ordinary domain
verification before sending. Historical email/domain ids remain with the old
team. No administrator exemption or new IAM permissions are involved.

The dashboard starts claims from **Add domain → Claim domain**, shows progress
at `/domains/{domain_id}`, and supplies copyable TXT records, retries, renewal,
and cancellation. Domain Connect's existing template handles sending records,
not the claim token; claims use manual TXT setup. Resend's claim documentation
specifies no owner notification email, so the audit trail uses the existing team
event outbox rather than installation-sender mail.

## Usage

`GET /usage` requires a full-access key (sending keys return `401 restricted_api_key`). It returns the calling team's usage; there are no request parameters. The dashboard at **Settings → Usage** (`/settings/usage`) reads the same aggregates.

```json
{
  "object": "usage",
  "emails": {
    "daily": { "used": 15, "limit": 200, "sent": 12, "received": 3, "resets_at": "2026-10-01T00:00:00.000Z" },
    "monthly": { "used": 120, "limit": null, "sent": 100, "received": 20, "resets_at": "2026-10-01T00:00:00.000Z" }
  },
  "contacts": { "used": 42, "limit": null },
  "segments": { "used": 2, "limit": null },
  "broadcasts": { "used": 4, "limit": null },
  "ai_credits": { "used": 0, "limit": 0, "next_increase_at": null },
  "automation_runs": { "used": 8, "limit": null, "resets_at": "2026-10-01T00:00:00.000Z" },
  "domains": { "used": 1, "limit": null },
  "rate_limit": { "limit": 10, "duration": "1000ms" }
}
```

Self-hosted semantics:

- Email counters use UTC calendar days/months, with `used = sent + received`. A send counts once when accepted by SES, by its send time (not creation or scheduling time); received mail counts by receipt time. System/account emails, queued/scheduled/failed-before-send emails, and other teams' emails are excluded. Retries and later delivery/open/click milestones do not add sends. Totals span all regions used by the team.
- The daily `limit` is the last stored SES `Max24HourSend` in the installation default region (teams inherit that region). It is **shared by every team**, never a team allocation. SES enforces a rolling 24-hour **sending** quota; this API's UTC sent-plus-received counter is not remaining SES capacity, and midnight does not reset SES's window. No AWS request is made. Missing stored quota/default region returns `null`; the dashboard explains why and links installation admins to Amazon SES settings. A stored zero is returned as zero. Check/refresh SES settings for current quota data.
- There is no billing plan: monthly email, contacts, automation runs, broadcasts and domains have `limit: null`. The first three intentionally differ from the numeric limits in Resend's current OpenAPI/resend-node types. Contacts include unsubscribed contacts; segments have no team limit (`null`, as Resend returns with a contacts subscription); broadcasts count existing sent broadcasts; domains count active domains. Automation runs count starts this UTC calendar month. API rate limits remain 10 requests per 1000ms per team.
- All current resend-node usage fields are returned. AI credits are unsupported and use `used: 0`, `limit: 0`, `next_increase_at: null`; there is no synthetic billing period or credit allowance.
- Reads use aggregate counts and indexed singleton quota lookups, never email/contact scans. Usage counters retain only aggregate keys/IDs after email content or automation runs expire, so day 31 does not lose day 1. Deleting a team clears its usage namespaces.

**Upgrade:** after deployment, run the existing `migrations:backfillCounts` runner, which now includes the separately named `countUsageSent`, `countUsageReceived`, and `countUsageAutomationRuns` migrations. They are idempotent and can run alongside writes. They populate usage from surviving sent milestones, received emails and automation runs. Counts are incomplete until backfill finishes; already-pruned historical records cannot be reconstructed. No new IAM permission is needed.

References: [Resend usage limits](https://resend.com/docs/api-reference/rate-limit), [resend-node usage types](https://github.com/resend/resend-node/blob/canary/src/usage/interfaces/get-usage.interface.ts).

## WhatsApp Cloud API

The team-scoped `/whatsapp/*` API is documented in `openapi/opensend.yaml`.
`POST /whatsapp/messages` queues a message and returns `{ id }`. Its `from`
accepts the connected phone number id or Opensend account id, and is required
unless the team has exactly one live number. The number must be active and
registered. Every type except `template` requires a customer service window
opened by an inbound message within the last 24 hours. The sender checks the
window again immediately before delivery.

Use an approved Meta template directly as `{ name, language, components }`
or `{ name, language, variables }`. Language accepts a code string or `{ code }`.
Positional variable keys must be consecutive (`"1"`, `"2"`, …); named keys
become Meta `parameter_name` values. `resolveWhatsAppTemplate` is the seam for
resolving stored templates when template management is integrated.
`reply_to` accepts an Opensend message id or wamid in the recipient's thread.

Uploads use `POST /whatsapp/media` with multipart fields `file`, optional
`from`, and optional `type` (MIME type, otherwise the file's Content-Type).
The response `{ id }` contains Meta's media id, usable in a media message.
Files are kept in Convex storage for 30 days, with cleanup on team retirement.
JPEG/PNG: 5 MiB; audio and video: 16 MiB; supported documents: 100 MiB;
static WebP stickers: 100 KiB; animated WebP stickers: 500 KiB. OGG must declare
`audio/ogg; codecs=opus`. Meta checks image format and audio/video codecs.
The deployment's HTTP body and memory limits may be lower than Meta's limit.

Sending or full-access keys can send and upload; domain-restricted sending
keys receive 403. Read endpoints require full access. Both POST endpoints
support the usual `Idempotency-Key`, and media replay hashes the actual bytes,
filename, MIME type and fields rather than the multipart boundary. API logs
record file metadata and the hash, without binary content. Read endpoints use
`limit`, `after` or `before` cursors. Messages also filter by `status`,
`direction` and `phone_number_id`. Message detail includes the event timeline
and signed media downloads. Delivery status never regresses. Retryable Graph
errors back off; an interrupted send is failed without an automatic resend,
because Graph provides no send idempotency token.

The SDK exposes `opensend.whatsapp.messages.send/get/list`, `media.upload`,
`phoneNumbers.list/get` and `conversations.list/messages`. The four MCP tools
are `send-whatsapp-message`, `list-whatsapp-messages`, `get-whatsapp-message`
and `list-whatsapp-phone-numbers`.

Payloads and limits were checked on 2026-10-01 against Meta's official
[Messages API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/message-api),
[message guides](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages),
[template parameter formats](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview#parameter-formats),
[media guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
and [Media Upload API](https://developers.facebook.com/documentation/business-messaging/whatsapp/reference/whatsapp-business-phone-number/media-upload-api).
All requests use the installation's configured Graph version.

The disposable end-to-end backend uses `META_GRAPH_ORIGIN` for the local fake
Graph server. Only when that origin is local, the reserved fixture endpoint
`https://whatsapp-send.invalid/events` is delivered to its `/__webhooks`
receiver, so the suite can inspect real signed customer deliveries. Every
other customer endpoint keeps the public HTTPS and DNS checks.

### Contact notes

Contact notes are plain text context attached to any contact, independent of a
channel or CRM. Bodies must contain text and be at most 10,000 characters.

| Route | Behavior |
| --- | --- |
| `GET /contacts/{id}/notes` | Requires `contacts:read`. Newest first; supports `limit`, `after`, and `before` ID cursors. |
| `POST /contacts/{id}/notes` | Requires `contacts:write`. Accepts `{ body, source? }`; returns the complete note with status 201. Supports `Idempotency-Key`. |
| `PATCH /contacts/{id}/notes/{note_id}` | Requires `contacts:write`. Updates `{ body }` and preserves the author, source, and creation time. |
| `DELETE /contacts/{id}/notes/{note_id}` | Requires `contacts:write`. Returns `{ object: "contact_note", id, deleted: true }`. |

A note contains `id`, `contact_id`, `body`, `author`, `source`, `created_at`, and
`updated_at`. The server derives the author from the dashboard user, API
key/OAuth caller, or voice bot. API requests can include source metadata with
`call_id`, `conversation_id`, or `message_id`; each reference must belong to the
same organization. Contacts may be addressed by ID or email, as on other contact
routes. Deleting a contact or team also deletes its notes.

Every create emits `contact.note_created` with the complete note as webhook
`data` and as the automation trigger payload. Edits and deletes do not emit this
event. Voice bots save on the caller's resolved contact, create it from a known
caller identity when needed, and keep the call-record copy. Calls without a
resolvable identity keep the call-record fallback.

The SDK exposes `opensend.contacts.notes.create/list/update/remove`, using
`contactId` and `noteId` options. MCP exposes `create-contact-note`,
`list-contact-notes`, `update-contact-note`, and `remove-contact-note`.

See [Unified Messages API](messages-api.md) for sending and reading across email, WhatsApp, Messenger and Instagram.
