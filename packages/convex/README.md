# @opensendcc/convex

Durable email delivery for Convex applications using [OpenSend](https://opensend.cc).
The component owns its queue and status tables, retries transient API failures,
and verifies signed delivery webhooks. It works with self-hosted installations
and the hosted API: **you must supply the API base URL**.

## Install and mount

```sh
pnpm add @opensendcc/convex
```

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server"
import { v } from "convex/values"
import opensend from "@opensendcc/convex/convex.config.js"

const app = defineApp({
  env: {
    OPENSEND_API_KEY: v.optional(v.string()),
    OPENSEND_BASE_URL: v.optional(v.string()),
    OPENSEND_WEBHOOK_SECRET: v.optional(v.string()),
  },
})
app.use(opensend)
export default app
```

Set your application deployment's environment variables:

```sh
pnpm exec convex env set OPENSEND_API_KEY os_your_key
pnpm exec convex env set OPENSEND_BASE_URL https://your-opensend-api.example.com
pnpm exec convex env set OPENSEND_WEBHOOK_SECRET whsec_your_webhook_secret
```

Use the API origin of your self-hosted installation or the API URL supplied for
your hosted account. There is no default host or automatic environment fallback.
Use a sending-access key or a custom key with `emails:write`. The sending domain
must be verified and ready in OpenSend.

## Send, status, and cancel

Construct the client inside function handlers: typed `env` is available at
runtime. The [example](./example/convex/email.ts) provides internal functions;
add your app's authorization before exposing equivalent public functions.

```ts
// convex/email.ts
import { OpenSend, vOnEmailEventArgs } from "@opensendcc/convex"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import { env, internalMutation } from "./_generated/server"

export function emailClient(): OpenSend {
  return new OpenSend(components.opensend, {
    apiKey: env.OPENSEND_API_KEY,
    baseUrl: env.OPENSEND_BASE_URL,
    webhookSecret: env.OPENSEND_WEBHOOK_SECRET,
    onEmailEvent: internal.email.onEmailEvent,
    maxAttempts: 5, // includes the first attempt; default 5
    initialBackoffMs: 2000, // default; doubles between retries
  })
}

export const sendWelcome = internalMutation({
  args: { to: v.string() },
  returns: v.string(),
  handler: async (ctx, { to }): Promise<string> =>
    emailClient().sendEmail(ctx, {
      from: "Your app <hello@verified.example.com>",
      to,
      subject: "Welcome",
      html: "<p>Welcome!</p>",
      text: "Welcome!",
      tags: [{ name: "category", value: "welcome" }],
      idempotencyKey: `welcome:${to}`, // optional enqueue deduplication
    }),
})

export const onEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (_ctx, { id, event }) => {
    console.log(id, event.type, event.opensendId)
    return null
  },
})
```

From any context with `runMutation`, call `sendEmail(ctx, options)`. It returns a
component email ID immediately, before delivery. `to`, `cc`, `bcc`, and `replyTo`
accept a string or an array. Custom `headers` use a string record.

Templates are an alternative to HTML/text. OpenSend can use a stored template's
sender and subject, so both fields are optional with a template:

```ts
await emailClient().sendEmail(ctx, {
  to: "recipient@example.com",
  template: { id: "your_template_id", variables: { name: "Ada", count: 3 } },
})
```

`scheduledAt` forwards OpenSend's scheduling field (prefer an absolute ISO 8601
time so retries don't move a relative schedule). `topicId` forwards an existing
email subscription topic. Scheduled mail leaves the component queue when the API
accepts it; the API owns its subsequent schedule.

```ts
const state = await emailClient().status(ctx, id)
// { status, opensendId?, errorMessage?, opened, clicked, complained } | null
const detail = await emailClient().get(ctx, id)
const canceled = await emailClient().cancelEmail(ctx, id) // boolean
```

Status is one of `queued`, `sent`, `delivery_delayed`, `delivered`, `bounced`,
`failed`, or `cancelled`. `sent` means the API accepted the request; webhook events
confirm subsequent delivery. Late events cannot regress lifecycle status.
Delivery evidence can supersede a failure, a bounce supersedes delivery, and
engagement flags only become true. `get()` returns the retained row, excluding
callback handles and workpool/idempotency internals. Bodies and attachments are
removed after acceptance or final failure/cancellation.

Cancellation is best effort: it returns true while the row is queued and false
after acceptance or finalization. An HTTP request already in flight may still
send; its API ID is retained even if cancellation wins the race. This method does
not cancel a schedule already accepted by the API.

## Signed webhooks and callbacks

```ts
// convex/http.ts
import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { emailClient } from "./email"

const http = httpRouter()
http.route({
  path: "/opensend/webhook",
  method: "POST",
  handler: httpAction((ctx, req) =>
    emailClient().handleOpenSendEventWebhook(ctx, req)
  ),
})
export default http
```

Register the app's HTTP action URL in OpenSend (the `.convex.site` URL for Convex
cloud, or your self-hosted HTTP action origin). Subscribe to:

- `email.sent`, `email.delivery_delayed`, `email.delivered`, `email.bounced`
- `email.failed`, `email.suppressed`, `email.complained`
- `email.opened`, `email.clicked`

OpenSend emits `svix-id`, `svix-timestamp`, and `svix-signature`. The equivalent
`webhook-*` header set is also accepted. Verification checks the raw body and
signature timestamp. Valid events return 204; bad signatures return 401; an
unset webhook secret returns 503. Unknown event types and unmatched IDs are
acknowledged and ignored.

`onEmailEvent` accepts a mutation reference or a function handle created with
`createFunctionHandle`. The callback receives `{ id, event }`, where `id` is the
component ID and `event` is a normalized object with `type`, `opensendId`, optional
`message`, and optional `componentEmailId` for early correlation. It runs in the
same transaction as the status/flag change; an exception rolls back the change
and makes webhook delivery retry. Replayed milestones and regressive lifecycle
events do not invoke it again. The first `email.sent` webhook invokes it even if
API acceptance already marked the row sent. Repeated opens/clicks represent one
flag transition, rather than a stream of all engagement activity.

`vOnEmailEventArgs`, `vEmailEvent`, `vStatus`, and `vTemplate` are exported.
`defineOnEmailEvent(handler)` is available as a convenience for defining the
internal callback mutation. The component adds the reserved
`opensend_component_email` tag to correlate signed events that beat the API
response; callers may not supply that tag. Up to 47 caller tags fit OpenSend's
48-tag API limit alongside it.

## Cleanup

```ts
// convex/crons.ts
import { cronJobs } from "convex/server"
import { components } from "./_generated/api"

const crons = cronJobs()
crons.interval(
  "clean up old mail",
  { hours: 24 },
  components.opensend.lib.cleanupOldEmails,
  {
    olderThan: 7 * 24 * 60 * 60 * 1000,
  }
)
export default crons
```

Alternatively call `emailClient().cleanupOldEmails(ctx, { olderThan })`.
`olderThan` is a retention duration in milliseconds, defaulting to one week.
Cleanup deletes at most 100 finalized rows per transaction and schedules further
batches using the same cutoff. Queued mail is never deleted. Applied webhook
activity refreshes the retention clock. Enqueue deduplication ends when its row
is deleted. Choose retention longer than the maximum API schedule and webhook
retry window if those events must still be tracked.

## Retries, credentials, and limits

The workpool uses a fixed **five concurrent workers**, not a request-per-second
rate limiter. OpenSend's API quota is **10 requests/second per team**, shared with
other keys and clients. A burst of fast sends can encounter 429s; those retry
with exponential backoff without holding a worker slot. Network errors, 5xx,
and concurrent idempotent requests also retry. Other 4xx failures (including
403 unverified senders and 422 invalid attachments) fail once with an error message. `maxAttempts` accepts
1–20; backoff is finite and nonnegative. Keep the total retry horizon below
OpenSend's 24-hour API idempotency retention window.

One API `Idempotency-Key` is generated per queued email and reused on every
attempt. The optional caller `idempotencyKey` deduplicates enqueues within this
component instance's retention window. Reusing it returns the original ID, even
if the supplied content differs: use a new key for a new logical email.

**The API key travels in mutation and persisted workpool action arguments**,
just as with the Resend component. It is not written to the component's email
rows or returned by `get()`, but privileged deployment administrators can access
workpool arguments. Rotate `OPENSEND_API_KEY` for new sends, keep the old key
valid until existing work drains, then revoke it. For immediate revocation,
cancel queued work and enqueue new requests using their original app-owned
content and new deduplication keys. Updating an environment variable does not
rewrite credentials already queued. Configure webhook secret rotation in the
app alongside OpenSend's overlap window.

All serialized email fields together must fit within **64 KiB** (UTF-8 JSON).
This leaves headroom under Convex's 1 MiB document/argument limits and bounded
cleanup transaction reads. Attachments support small base64 `content`, HTTPS
`path` URLs, and completed OpenSend media-upload `id` references, with `filename`,
`contentType`, and `contentId`. Buffers, file paths on disk, and large inline
attachments are unsupported. Upload large files through the SDK's media API
outside this component, then pass their IDs; OpenSend still enforces its own
attachment limits and URL policy. React elements are not Convex values: render
them to HTML in a Node action first.

This package keeps the k4stack client shape and core Resend component features.
The full [parity and migration report](../../docs/convex-component.md) records
intentional differences; this is not a drop-in Resend API replacement.

## Development and verification

```sh
pnpm --filter @opensendcc/sdk build
# Point codegen at an isolated Convex backend, never the product deployment:
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 \
CONVEX_SELF_HOSTED_ADMIN_KEY=your_test_admin_key \
  pnpm --filter @opensendcc/convex build
pnpm --filter @opensendcc/convex test
pnpm --filter @opensendcc/convex typecheck
pnpm --filter @opensendcc/convex lint
node scripts/test-convex-component.mjs
```

Codegen uses `convex codegen --component-dir` and requires an existing deployment;
it does not run `convex dev`. Generated bindings are committed. `./test` exports
`register(t, name = "opensend")` for convex-test; it registers the nested workpool
and batch worker too. The package uses the official component template's
source/test/config/type export layout.

The Docker harness builds and installs the component **tarball** into a temporary
copy of the example, with a packed SDK override so an unpublished SDK 0.1.2 can
be tested. It starts an isolated opensend backend/migrate stack plus a separate
Convex backend, exercises the real `/emails` contract and signed webhooks, and
removes only its own project, volumes, and unique migrate image. It uses the
existing e2e synthetic SES state and SES projection ingestion boundary. SES
acceptance is substituted in the disposable deployment; SNS signature checking,
AWS delivery, and live DNS verification are not tested. A narrowly scoped local
HTTP transport exception exists only in that disposable deployment because the
product correctly requires public HTTPS webhook destinations. Docker is required.

Publish the SDK's V8-safe `@opensendcc/sdk/convex` entry in **SDK 0.1.2 first**;
then this component's packed dependency resolves to `@opensendcc/sdk: ^0.1.2`.
Neither package is published by the harness.
