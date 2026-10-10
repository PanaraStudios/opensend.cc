# OpenSend Convex component

[`@opensendcc/convex` installation and API guide](../packages/convex/README.md)
includes the example, environment variables, webhooks, retries, limits, and
cleanup. Source lives in `packages/convex`; it does not depend on the website.

Run `node scripts/test-convex-component.mjs` from the root after `pnpm install`
on a Docker host. It packs and installs the packages into an isolated example,
tests the real opensend API and signed webhooks, and tears down its own stack.
SES acceptance and SNS ingestion use synthetic fixtures, as described in the
README; the harness does not prove live AWS/DNS behavior. Release SDK 0.1.2
before component 0.1.0; no publish or push is performed here.

The requested unverified-sender assertion is **403**, matching the actual
`convex/emails.ts` contract, rather than 422. The harness separately tests a
real **422** invalid-attachment rejection. Delivery and bounce are injected at
the existing SES projection boundary; there is no SES simulator supporting
special recipient addresses in this stack.

## Parity with @convex-dev/resend 0.2.8

Compared against the published source tarball, rather than its underlying SDK.

| Capability                                           | OpenSend component    | Difference / reason                                                                  |
| ---------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `sendEmail(ctx, options)` from mutation/action       | Supported             | Keeps the k4stack object API; required explicit API origin                           |
| HTML/text; templates; cc/bcc/reply-to; headers       | Supported             | Headers are a string record; templates may inherit sender/subject                    |
| Durable background queue and retries                 | Supported             | One send per work item; five workers rather than Resend batching                     |
| Stable API idempotency; caller enqueue deduplication | Supported             | Caller key deduplication lasts until cleanup                                         |
| Tags, API scheduling, topics, attachments            | Supported with limits | Actual OpenSend `/emails` fields; 64 KiB total input; no Buffer/disk uploads         |
| Status, engagement flags, `get`, queued cancellation | Supported             | API ID in status; boolean cancellation; k4stack status names                         |
| Signed webhook and `onEmailEvent` mutation/handle    | Supported             | Both header sets; normalized event; callbacks on first milestone/flag transitions    |
| Callback validator and `defineOnEmailEvent`          | Supported             | Component ID is a string, without Resend's branded type                              |
| Cleanup cron and convex-test registration            | Supported             | Fixed cutoff, batches of 100; registers nested workpool/batchWorker                  |
| `sendEmailManually`                                  | Unsupported           | Use the SDK in an app Node action for custom delivery; no manual queue insertion API |
| Deprecated positional send overload                  | Unsupported           | Object format only; preserves k4stack API                                            |
| Resend `testMode` and default environment fallback   | Unsupported           | Provider-specific test-address restrictions; credentials/origin are explicit         |
| Resend raw event data and every engagement callback  | Unsupported           | Bounded normalized event and monotonic milestones/flags; no raw activity stream      |
| Resend batching / same status/get shapes             | Unsupported           | OpenSend-specific API and k4stack lifecycle; migration requires field adaptation     |

## Changes from the five k4stack files

1. Created official-template package layout, exports, generated bindings,
   Apache license, build/check scripts, test registration, example and docs.
2. Extracted delivery into a separate module using SDK 0.1.2's V8-safe entry.
   Convex rejects Node components; the SDK main entry imports disk-upload APIs.
   SDK resource clients now share an extracted transport, and JSON gateway
   errors missing a numeric status code inherit the HTTP status for retries.
3. Added templates with optional inherited sender/subject, tags, scheduledAt,
   topicId, and string/base64, URL, or upload-ID attachments.
4. Added validation at the client and component boundaries: content/template
   alternatives, sender/subject, explicit HTTP(S) base URL, credentials,
   bounded retry policy, reserved tag and 64 KiB serialized email size.
5. Added optional caller enqueue idempotency keys and an indexed lookup; a
   repeated key returns the original component ID during retention.
6. Added persisted app callback handles, transactional `onEmailEvent`, exported
   validators/types and the callback-definition helper.
7. Accepts both svix-* and webhook-* headers, rejects arrays as event records,
   and safely ignores unknown event types, malformed data and unknown IDs.
8. Added a reserved correlation tag and verified-event fallback lookup to
   handle webhooks arriving before the API response or after exhausted network
   retries without a response. Records acceptance in a
   mutation before the asynchronous workpool completion callback.
9. Preserves API IDs on in-flight cancellation and protects statuses already
   advanced by a webhook from completion callbacks.
10. Tracks the first sent webhook separately from API acceptance so its app
    callback fires once; repeated/regressive milestones don't call it again.
11. Orders failure below delivery evidence, bounce above delivery, and
    cancellation last; engagement flags stay independent and monotonic.
    Confirmed delivery clears a superseded failure message.
12. Returns opensendId in status; adds `get()` without private work/callback
    fields and a client cleanup wrapper.
13. Removes bodies, templates and attachments after acceptance, failure or
    cancellation; refreshes retention when a webhook is applied.
14. Cleanup uses one fixed cutoff, a private scheduled continuation and validated
    retention, while keeping queued rows out of its index range.
15. Corrected the claim that five parallel sends enforce 10 requests/second:
    concurrency is fixed at five and rate-limit responses retry with backoff.
16. Added 38 workpool/SDK/webhook/cleanup tests, SDK transport regressions,
    a tarball-consumer Docker harness and shared synthetic e2e SES fixture data.
17. Documented key propagation and rotation, schedules/cancellation ownership,
    idempotency retention, attachment limits and deliberate Resend differences.
18. Added the nested example to the pnpm workspace; root scripts stay unchanged.
