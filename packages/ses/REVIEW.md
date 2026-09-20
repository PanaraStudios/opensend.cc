# SES component review

Reviewed 2026-09-12 against the supplied implementation, the official Convex Resend component, installed Convex/AWS SDK types, and official AWS/Convex documentation. Fixes are implemented in this package. The root starter app and cloud deployments were not changed during this review.

## Findings and fixes

| Priority | Finding | Implemented correction |
| --- | --- | --- |
| High | Extra JavaScript properties on a send input could overwrite the trusted runtime options, including `testMode`. TypeScript's excess-property checks did not protect runtime inputs. | Write trusted configuration after spreading message parameters. Regression verifies an input cannot disable test mode. |
| High | A queued email could be cancelled after the worker loaded its payload but before SES accepted it. The send still occurred while the database said cancelled and could lose the provider ID. | Transactionally claim each send immediately before the API call. Cancellation and claim now have a defined winner; cancellation is refused after claim. |
| High | SNS could arrive before the send outcome mutation. Unknown IDs were acknowledged and dropped permanently. | Correlate signed events using a reserved per-email SES tag when possible. Otherwise return HTTP 503 so SNS retries after the ID is recorded. |
| High | Sending and callbacks used the most recently enqueued options. Another SES instance could change pending emails' credentials/region or route callbacks to a different handler. Manual-only usage had no callback configuration at all. | Snapshot runtime options and callback per email; batch by matching options. Manual creation saves its own callback. Private metadata is omitted from `get()`. |
| High | The claimed no-duplicate delivery guarantee was not possible: the SDK retried internally, and SES acceptance was not atomic with Convex persistence. | Disable automatic SDK retries, reserve quota on workpool attempts, persist accepted outcomes immediately, and use early event correlation. Document the remaining lost-response/crash duplicate window rather than promise exactly-once delivery. |
| High | Manual sends bypassed test-mode destination checks. Weak display-name extraction could accept an address list ending in a simulator mailbox. | Check manual To/CC/BCC before invoking the callback; validate single mailboxes and reject list/injection tricks. The callback still owns the actual request. |
| Medium | Batch quota reservations counted emails rather than recipients, did not cover retries, and local pacing was independent across workers. | Reserve recipient tokens through the shared limiter at execution time, including retries. Limit bulk groups by recipient budget. AWS account-wide/daily limits remain external constraints. |
| Medium | Replayed SNS notifications appended duplicate audit rows and invoked callbacks repeatedly. | Deduplicate by signed topic ARN + SNS MessageId inside the event mutation. Distinct notification IDs remain distinct events. |
| Medium | Certificate fetches accepted arbitrary paths/ports on SNS hosts, followed redirects, and cached without bounds. Invalid signature base64 could become an operational exception. | Require a matching region/partition SNS certificate URL and expected certificate path; reject credentials/query/fragment/nonstandard ports; disable redirects; bound reads, timeouts, cache size and TTL; normalize invalid base64 into verification rejection. |
| Medium | Cleanup could exceed transaction limits on large event histories. Batch hydration could produce oversized action payloads. Numeric controls accepted infinities/fractional attempts. | Drain event histories in bounded scheduled passes; cap input and batch bytes/time budgets; validate tuning and retention parameters. |
| Medium | `sendEmailManually` could mark an accepted email failed if persisting success threw. The manual example omitted the configuration set, so event tracking was incomplete. | Separate callback failure from success persistence; preserve already recorded provider IDs/events; supply configuration set and explicit/session credentials in examples. |
| Medium | Test registration omitted nested workpool/rate-limiter components; passing tests did not exercise actual scheduling or SDK signing. | Register all nested components, add scheduler/retry/callback regressions and a deployed synthetic-transport SDK signing action. |
| Medium | `prepack` ran deployment-affecting component codegen as a side effect of packaging. | Keep packing/build verification local; codegen is an explicit development command. |
| Medium | Reputation protection was not an explicit setup requirement. Status flags alone do not stop later sends to bad recipients. | Setup helper enables BOUNCE and COMPLAINT suppression for the selected configuration set and reports effective settings. Runbook covers app-owned suppression/callback handling. |
| Compatibility | Resend-style template `{ id, variables }` was rejected. | Accept that form and map it to SES template name/data; retain native SES templates as an extension. |

No missing-auth finding is assigned to public **component** functions: Convex components are isolated and not directly callable by browser clients. The app must authorize any wrappers it exposes. The example's sending functions are internal, and its HTTP entry point authenticates SNS signatures and topic membership.

## Verification

- Original baseline: 110 passing tests.
- Final package suite: **145 passing tests**, including actual nested workpool execution, throttling retry, partial bulk success, early event recovery, cancellation races, callback routing, Resend-style template input, trusted-options injection, SNS RSA verification and deduplication, and bounded cleanup.
- **5 offline Python setup-script tests** pass: read-only default, wrong-account refusal, existing-resource preservation, scoped topic-policy merge, and AWS-returned DKIM hosted-zone handling.
- Local package archive was inspected: required runtime/type exports, runbook, review, and setup scripts are present; no environment files or Python caches are packaged.
- Package build, TypeScript checks (including the example), and ESLint pass via `pnpm run verify`.
- Component and example deployed successfully, with component typechecking, to a disposable localhost Convex backend. All nested components were installed there.
- `smoke:runtimeSdk` executed in the actual Convex runtime using the real AWS SDK with synthetic transport. Result: `signed: true`, host `email.us-east-1.amazonaws.com`, message ID `synthetic-runtime-ok`.
- Real AWS account provisioning, IAM permission evaluation, DNS propagation, SES sending, suppression, and SNS HTTPS delivery **have not been tested against your AWS account**. Follow the runbook and require the live simulator script to pass before adopting it in production.

## Limits that remain by design

1. Exactly-once external delivery cannot be guaranteed without SES send-time idempotency. Retries after an ambiguous outcome can send a duplicate. A reserved SES tag reduces the correlation gap but cannot eliminate it.
2. Runtime credentials are stored in private execution data so background workers can send; scheduler/workpool retention and backups may retain them. Temporary credentials require an external refresh process. Drain pending work before rotating credentials.
3. The limiter coordinates one component instance. AWS's daily quota, other applications, and independent mounts can still cause throttling. Prefer one recipient per transactional email and set a conservative rate.
4. The component records recipient feedback but does not own application contacts or suppression UX. The setup helper configures SES transport suppression; app wrappers should also avoid enqueueing known permanent bounces/complaints. Do not disable suppression through alternate configuration sets or manual calls.
5. The callback owns manual requests, rate control, attachments and retries. Test-mode checks validate declared destinations; they cannot inspect arbitrary callback code.
6. SES credentials, SNS webhook setup, native event payloads, and provider IDs differ from Resend. Common method names/argument patterns and status flags are retained. SES templates render their own subject.
7. New queued inputs are capped at 128 KiB and 50 recipients. Cleanup removes message history and ends the associated enqueue-deduplication window.

## Primary references

- [Official Convex Resend component](https://github.com/get-convex/resend)
- [Convex component authoring](https://docs.convex.dev/components/authoring)
- [Convex runtimes](https://docs.convex.dev/functions/runtimes)
- [SESv2 SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html)
- [SESv2 SendBulkEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendBulkEmail.html)
- [SES recipient-based quotas](https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html)
- [SNS signature verification](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message-verify-message-signature.html)
- [SNS delivery retry behavior](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html)
- [SES event formats](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-contents.html)
- [SES suppression options](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutConfigurationSetSuppressionOptions.html)
