# AWS SES + Convex setup and verification

This starter kit sends transactional email from **the developer's own verified sending domain**. The component does not manage customer domains. Domain verification is a one-time AWS/DNS setup for each region.

Start here whether you have a new AWS account or already send with SES. Commands below run from `packages/ses` unless a different directory is shown. Replace every example account, domain and deployment with your own. Nothing in the local test suite sends real email.

## Choose your starting point

| Your situation | Start at |
| --- | --- |
| No AWS account | 1, then continue through every section |
| AWS account, no SES setup | 2 |
| SES already enabled, verified domain available | 3: inspect existing resources, then 5 |
| Existing SES/SNS configuration | 3 and 5: verify region, topic permission, raw delivery setting, and enabled events |
| Only testing component code | 9: local verification |

Keep separate configuration sets, SNS topics, IAM keys, and Convex deployments for development and production. A dedicated topic prevents unrelated apps' notifications from hitting this component.

## 1. Create and secure your AWS account

1. Follow [AWS account signup](https://docs.aws.amazon.com/accounts/latest/reference/getting-started.html). Complete email, contact, payment, phone verification, and the support-plan selection in the signup flow. See also [SES setup](https://docs.aws.amazon.com/ses/latest/dg/setting-up.html).
2. Sign in to the AWS console. Enable MFA on the root user. Use an administrative identity through IAM Identity Center for day-to-day setup; do not create root access keys. Follow [AWS IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html).
3. Open the SES console and choose the AWS region where you will send email. Use that same region throughout this runbook.
4. Have access to DNS for a domain you own, such as `example.com`. This does not require changing the domain's website hosting or inbound email provider.
5. SES and SNS are paid AWS services. Review their pricing in your AWS account and configure an AWS budget appropriate for your project. The setup scripts do not enable dedicated IPs or paid deliverability add-ons.

## 2. Workstation and Convex prerequisites

Install the [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), Python 3.10+, Node.js 22+, and this repository's pnpm version. Use the repository lockfile:

```sh
# repository root
pnpm install --frozen-lockfile
cd packages/ses
pnpm run verify
```

Authenticate your setup/admin identity using your organization's approved method, for example:

```sh
aws configure sso --profile k4stack-setup
aws sso login --profile k4stack-setup
aws sts get-caller-identity --profile k4stack-setup
```

Record the 12-digit AWS account ID from that response. The helper refuses to change resources in a different account.

Create a Convex account/project at [Convex](https://dashboard.convex.dev), or use your existing project. For the included example, use a **dedicated test project**, since deploying `example/convex` to an existing app deployment replaces its app functions. Do not point the example at the starter app's deployment.

The included package uses `convex.json` with `functions: "example/convex"`. From `packages/ses`, initialize/select that dedicated project interactively:

```sh
pnpm exec convex dev --configure new --once
```

If it already exists, use `--configure existing --once` and select it. Confirm the displayed project and deployment. Record both its `.convex.cloud` URL and its **`.convex.site`** URL. SDK clients use `.cloud`; SNS uses `.site`.

For code generation while developing the component, `pnpm run build:codegen` may upload component definitions to the selected deployment. Use only the dedicated test project. Ordinary `pnpm run verify`, `build`, and `pnpm pack` do not deploy.

## 3. Inspect an existing account, or prepare SES resources

Run the helper first without `--apply`. It reads the account's sending status/quota, the named domain identity, configuration set, topic, subscriptions, and DNS verification information.

```sh
python3 scripts/aws-setup.py \
  --profile k4stack-setup \
  --region us-east-1 \
  --account-id 123456789012 \
  --domain example.com \
  --configuration-set k4stack-transactional-dev \
  --topic k4stack-ses-events-dev
```

If you already have an SES identity, supply that domain and region. Existing verified identities and their DKIM configuration are preserved. You can either supply your existing configuration set/topic names or use dedicated ones for this app. Review any existing subscribers before reusing a topic.

Add `--apply` to create missing resources and configure event publishing:

```sh
python3 scripts/aws-setup.py \
  --profile k4stack-setup \
  --region us-east-1 \
  --account-id 123456789012 \
  --domain example.com \
  --configuration-set k4stack-transactional-dev \
  --topic k4stack-ses-events-dev \
  --apply
```

This helper:

- Creates a missing domain identity with Easy DKIM and a 2048-bit signing key.
- Creates a missing configuration set and standard SNS topic.
- Sets SNS signature version 2 and merges its `K4StackSesEventPublishing` policy statement, preserving other statements. The new statement permits SES publishing only from your account and the selected configuration set.
- Enables `BOUNCE` and `COMPLAINT` suppression on the selected configuration set. This overrides that set's suppression options, while leaving account-wide settings alone. Review the change if reusing an existing set.
- Creates or updates the **`k4stack-events`** destination on that configuration set, enabling all supported SES event types. Other destinations are preserved; duplicate destinations can produce separate notifications for the same event.
- Prints non-secret Convex settings, exact DKIM DNS records when provided by AWS, and a scoped runtime IAM policy.

It does **not** change DNS, create IAM users/access keys, request production access, enable sending on a paused account, deploy Convex, or send emails. It is intended for a setup identity with permission to manage those SES/SNS resources; your runtime sending key will have fewer permissions.

For a console-only setup, create the same identity, configuration set, standard SNS topic, and SNS event destination. Follow [AWS's SNS event-destination guide](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html), including its topic access policy. Enable sends, deliveries, bounces, complaints, rejections, rendering failures and delivery delays. Open/click/subscription events are optional for transactional mail; enabling them does not make the simulator generate them.

If your existing topic uses a customer-managed KMS key, configure the key policy to allow SES as described in that AWS guide. The helper preserves encryption and does not edit KMS policies.

## 4. Verify your sending domain

1. Add the three DKIM CNAME records printed by the helper to your DNS provider. Use the **exact values** returned by SES. AWS's `SigningHostedZone` can vary by identity and region; do not hard-code `dkim.amazonses.com`. If the field is unavailable, copy the three records from SES → Identities → your domain → Authentication.
2. At DNS providers that automatically append your zone name, enter only the relative name (for example, `TOKEN._domainkey`), avoiding `example.com.example.com`. If using Cloudflare, set DKIM CNAMEs to DNS only.
3. Wait for DNS propagation, then rerun the read-only helper. SES should show verified-for-sending and DKIM status `SUCCESS`. AWS allows up to 72 hours for verification.
4. Select a From address such as `Acme <no-reply@example.com>`. Domain verification generally permits addresses on that domain; check for an explicitly verified email/subdomain with more specific settings if your expected configuration is not applied.
5. Keep an actual monitored address in `replyTo` if recipients should be able to respond. SES sending does not provision an inbox.

See [AWS identity verification](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html) and [region-specific identity/DKIM behavior](https://docs.aws.amazon.com/ses/latest/dg/regions.html).

### Optional: custom MAIL FROM, SPF and DMARC

The visible `From` address and the envelope MAIL FROM domain are different. SES can send with its default `amazonses.com` envelope domain while DKIM authenticates your visible domain.

For a custom envelope domain, use a dedicated subdomain such as `bounce.example.com`:

1. SES → Identities → domain → Authentication → Custom MAIL FROM → Edit.
2. Set `bounce.example.com`. Select the behavior on MX failure deliberately: reject the message, or fall back to the default SES MAIL FROM domain.
3. Add the exact **MX and SPF TXT records shown by SES** for that subdomain and region. Do not replace your main domain's inbound mail MX records. Do not create multiple SPF TXT records at the same name.
4. Verify MAIL FROM status in SES. Add/review DMARC for your visible sending domain with the people who manage your existing mail. Preserve policies required by other senders.

Use [AWS's MAIL FROM guide](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html) and [DMARC guidance](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dmarc.html). No component code changes are required for this setup.

## 5. Create narrowly scoped runtime credentials

The Convex component uses the SES **HTTPS API**, not SMTP. SES SMTP usernames/passwords will not work as `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.

1. In IAM, create an application identity for this starter kit, separate from your human setup/admin identity. The helper prints a send-only policy scoped to your domain identity, configuration set, and this account/region's templates. If you use named templates, narrow `template/*` to those template ARNs; inline-only/simple messages do not require access to stored template resources.
2. Grant only `ses:SendEmail` and `ses:SendBulkEmail` on those resources. Do not grant runtime credentials permission to manage domains, publish arbitrary SNS messages, create users, or administer AWS. See [SES v2 IAM actions and resources](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).
3. For the IAM-user setup in the console: IAM → Policies → Create policy → JSON → paste the helper's runtime policy with your real ARNs → name it `K4StackSesSenderDev` → Create policy. Then IAM → Users → Create user → name it `k4stack-ses-dev` → leave console access disabled → Attach policies directly → select that policy → Create user. Open the user → Security credentials → Access keys → Create access key → choose the application-outside-AWS use case. Save the access key ID and secret securely; the secret is shown only once. Enter them in Convex in section 6, then remove any downloaded credential CSV from ordinary project/download folders.
4. Convex does not automatically assume your AWS role or inherit your workstation's SSO session. This implementation accepts explicit AWS credentials. Prefer a role-based temporary-credential integration when you have a secure refresh mechanism; this package does not provide one. Never put a human/admin access key into the app.
5. Temporary credentials also require `AWS_SESSION_TOKEN`. You must refresh them before expiry; this component does not implement STS credential renewal. Queued work snapshots credentials, so draining the queue before rotation avoids retries with old keys.

Credentials are passed to component workers and stored in private component execution data. They may also be present in retained scheduler/workpool records and backups; Convex deployment administrators can access them. Restrict that access and rotate keys. `get()` and `status()` do not expose credentials. Never put them in `NEXT_PUBLIC_*`, `VITE_*`, browser code, checked-in files, or a support transcript.

## 6. Set environment variables and deploy the example

For each command, use the exact dedicated **development deployment name** from your dashboard. Omit secret values to enter them interactively and avoid shell history:

```sh
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_REGION us-east-1
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_ACCESS_KEY_ID
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_SECRET_ACCESS_KEY
# Only for temporary credentials:
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_SESSION_TOKEN
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_SES_CONFIGURATION_SET k4stack-transactional-dev
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_SES_SNS_TOPIC_ARN arn:aws:sns:us-east-1:123456789012:k4stack-ses-events-dev
pnpm exec convex env set --deployment YOUR_DEV_DEPLOYMENT AWS_SES_MAX_SEND_RATE 1
```

Set the rate at or below your account's SES sending rate, leaving room for other senders. It is measured in **recipients per second**, including CC/BCC. Keep the sandbox default of 1 initially. Prefer one recipient per transactional message.

Build the package and deploy the example to the project you selected in section 2:

```sh
pnpm run build
pnpm exec convex dev --once --typecheck-components
```

Confirm the CLI names the intended development deployment. The example installs the SES component plus its nested workpools and rate limiter. Its sending/diagnostic functions are internal; the only public endpoint is the SNS webhook.

## 7. Connect and confirm SNS

Your example webhook is `https://YOUR_DEV_DEPLOYMENT.convex.site/ses-webhook`. The route and `AWS_SES_SNS_TOPIC_ARN` must already be deployed/set before subscribing.

Run the setup helper again with the same arguments, adding:

```sh
# Append these to the full aws-setup.py command from section 3:
--apply --subscribe https://YOUR_DEV_DEPLOYMENT.convex.site/ses-webhook
```

Or create the subscription in SNS: protocol **HTTPS**, endpoint above, **raw message delivery disabled**. Leave raw delivery disabled: signature verification needs the SNS envelope.

The handler verifies the message signature and allowed topic, then confirms the subscription. Rerun the read-only helper or inspect SNS subscriptions until its ARN replaces `PendingConfirmation`. If a prior confirmation expired before the webhook was ready, request confirmation again from SNS.

The topic must permit SES to publish and the configuration set must point to that topic. Merely creating a subscription does not enable SES event publishing.

## 8. Prove sending and callbacks with live SES

No real recipient is needed: test mode defaults to `true` and restricts destinations to the SES mailbox simulator. Test mode **still makes real AWS API calls**, requires valid credentials/a verified sender, and may incur charges.

From `packages/ses`:

```sh
python3 scripts/live-smoke.py \
  --deployment YOUR_DEV_DEPLOYMENT \
  --from 'Acme <no-reply@example.com>' \
  --timeout 300 \
  --output /tmp/k4stack-ses-live-result.json
```

Expected result: **PASS**, with every case `passed: true`. This checks:

- Normal delivery, hard bounce, and complaint via the simulator.
- Two inline-template sends; they use bulk sending when your configured rate and batching permit it.
- Transactional enqueue deduplication using `idempotencyKey`.
- A cancelled email that never enters the send worker.
- Callback execution in your app, not just `sent` status from the API.

The helper polls with a timeout and saves status/error evidence. It does not deploy code, change settings, or disable test mode. Do not treat `sent` as proof of delivery: it only means SES accepted the message.

Optional manual-send check:

```sh
pnpm exec convex run --deployment YOUR_DEV_DEPLOYMENT example:sendManual '{"from":"no-reply@example.com"}'
```

Inspect that email in the component dashboard and confirm delivery. Manual sends must explicitly set `ConfigurationSetName` on their SDK call; the included example does so. The simulator does not prove inbox placement, open/click tracking, or every delivery-delay/rendering-failure scenario. Local tests cover event parsing/state transitions; check any additional features you actually enable with live AWS.

## 9. Local checks and what they prove

```sh
pnpm run verify
python3 -m unittest discover -s scripts -p 'test_*.py'
```

The TypeScript suite uses `convex-test`, including real nested workpool/rate-limiter logic, plus synthetic AWS transport or SDK mocks. It covers retries, partial bulk failures, cancellation races, out-of-order events, signature verification with RSA certificates, SNS replay deduplication, test-mode restrictions, input bounds, callback configuration, and retention.

`smoke:runtimeSdk` exercises actual AWS SDK serialization/signing in a deployed Convex action with a synthetic transport; it does not contact AWS:

```sh
pnpm exec convex run --deployment YOUR_DEV_DEPLOYMENT smoke:runtimeSdk '{}'
```

Expect `signed: true`, host `email.us-east-1.amazonaws.com`, and message ID `synthetic-runtime-ok`. These checks cannot prove your AWS IAM, DNS, SES quota, or SNS subscription. Section 8 is the live acceptance gate.

## 10. Use it in the starter app

After the example passes, install the workspace package in the root app (run at the repository root):

```sh
pnpm add -w '@k4stack/ses@workspace:*'
pnpm --filter @k4stack/ses build
```

Merge the following into your app's existing files; do not replace its auth, routes, or components.

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server"
import ses from "@k4stack/ses/convex.config"
const app = defineApp()
app.use(ses)
export default app
```

```ts
// convex/sendEmails.ts
import { SES, vOnEmailEventArgs } from "@k4stack/ses"
import { components, internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { v } from "convex/values"

export const ses: SES = new SES(components.ses, {
  testMode: true,
  onEmailEvent: internal.sendEmails.handleEmailEvent,
})

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  returns: v.null(),
  handler: async (ctx, { id, event }) => {
    // Correlate id with your app's email/job record. Apply business-specific
    // handling for Bounce and Complaint, such as suppressing further sends.
    console.log("Email event", id, event.eventType)
    return null
  },
})
```

```ts
// Add this route to convex/http.ts
import { httpAction } from "./_generated/server"
import { ses } from "./sendEmails"

http.route({
  path: "/ses-webhook",
  method: "POST",
  handler: httpAction((ctx, req) => ses.handleSesEventWebhook(ctx, req)),
})
```

Call from an authorized server mutation/action using the familiar API:

```ts
const id = await ses.sendEmail(ctx, {
  from: "Acme <no-reply@example.com>",
  to: "success@simulator.amazonses.com",
  subject: "Welcome",
  html: "<p>Your account is ready.</p>",
  idempotencyKey: `welcome:${accountId}`,
})
await ses.status(ctx, id)
await ses.get(ctx, id)
// await ses.cancelEmail(ctx, id) // only before sending starts
```

The Resend-style template input is also accepted: `template: { id: "YourSesTemplateName", variables: { name: "Ada" } }`. SES renders the template subject, so a separate `subject` is ignored for templates. SES-native `{ name, data }`, `{ arn, data }`, and `{ content, data }` are also supported.

Authenticate/authorize callers in app wrappers. Do not expose arbitrary `from`, `to`, body, or email-ID lookups to unauthenticated clients. For password-reset/verification flows, enforce your auth flow's rate limits and choose the sender on the server. The component's test mode and quota limiter do not replace app authorization.

Repeat environment and SNS setup for the **starter app's** deployment and webhook URL. Run your application flow in dev before production. The review does not automatically wire SES into the root app or replace your authentication provider's email integration.

## 11. Production and ongoing operation

1. If still in the sandbox, use SES → Account dashboard → Request production access. Choose **Transactional**, provide your real website and intended traffic, and describe your bounce/complaint handling. Submit accurate details and wait for AWS approval. This is region-specific. Existing production-enabled SES accounts can skip the request. Follow [AWS production-access instructions](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
2. Repeat setup using production-specific IAM credentials, configuration set, SNS topic, and Convex environment variables. Verify the production webhook subscription. Never deploy the example app over your real app.
3. Set `testMode: false` deliberately in your production SES client. Keep it true in dev. Confirm SES production access and sending-enabled status, then send a single real message to an inbox you control.
4. Confirm inbox receipt, sender/reply-to, DKIM/SPF/DMARC results as applicable, and the Delivery callback. Start with a conservative `maxSendRate` and review AWS account quota usage.
5. Implement bounce/complaint handling in the app. The component records events; it does not own your user/contact suppression policy. Respect SES account suppression as well.
6. Install retention crons from `example/convex/crons.ts` or the README. Default finalized retention is 7 days; abandoned retention is 30 days. Tune for your needs and sensitive message content. Cleanup deletes message bodies and event history; deleting an email also ends its enqueue-idempotency window.
7. Monitor failed sends, oldest waiting/queued messages, workpool failures, SNS delivery failures, and SES bounce/complaint metrics. Set up SNS delivery-status logging or a dead-letter queue if you require notification recovery beyond normal SNS retries. See [SNS delivery retries](https://docs.aws.amazon.com/sns/latest/dg/sns-message-delivery-retries.html).
8. For key rotation: stop new enqueues, drain pending work, replace keys in Convex, verify a simulator send, then revoke the old key. Do not delete component/workpool tables to rotate credentials. Manual sends are not automatically retried or rate limited.

### Bounce and complaint protection

The setup helper enables both suppression reasons on this app's configuration set, including for an existing SES account. This makes SES suppress matching addresses after hard bounces or reported complaints. Re-run the read-only helper and confirm `SuppressionOptions.SuppressedReasons` includes `BOUNCE` and `COMPLAINT`.

If configuring manually:

```sh
aws sesv2 put-configuration-set-suppression-options \
  --profile k4stack-setup --region us-east-1 \
  --configuration-set-name k4stack-transactional-dev \
  --suppressed-reasons BOUNCE COMPLAINT
```

Use the selected configuration set on **every** queued and manual send. An override to another configuration set can change suppression behavior. Suppressed sends may be accepted by SES without delivery and still consume daily quota; inspect subsequent events. SES cannot report complaints that receiving providers do not share. See [AWS suppression behavior](https://docs.aws.amazon.com/ses/latest/dg/sending-email-suppression-list.html) and [configuration-set suppression API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutConfigurationSetSuppressionOptions.html).

The component also records `bounced`/`complained` flags and delivers the full feedback to `onEmailEvent`. In the starter app's callback, persist permanent bounce recipients (`event.bounce.bounceType === "Permanent"`) and complaint recipients using the explicit recipient arrays in the event. Check that app-owned record before future enqueues; do not suppress every recipient of a multi-recipient email because one bounced. Do not permanently suppress transient delays or soft bounces. Do not automatically remove a complaint suppression during login, retry, or password reset. Address correction/reinstatement needs an explicit application process.

AWS suppression protects transport delivery; app-side suppression prevents needless enqueues and supports account UX. The component does not own the app's users/contact policy. SNS webhook health, abuse/rate controls on authentication endpoints, and reputation monitoring remain necessary. Simulator success/bounce/complaint tests validate event handling, not real-address suppression or inbox placement.

### Delivery guarantees and provider differences

The method shapes match the Resend component, but AWS is a different delivery service:

- `idempotencyKey` deduplicates enqueues transactionally within a component instance for as long as the email record exists. Use a stable business-event key, not a random key per retry. Reusing a key with different content returns the original email; it does not update it.
- SES has no send-time idempotency key. SDK automatic retries are disabled; the workpool retries transient failures. Recorded accepted emails are skipped. A reserved `convex-email-id` message tag lets an early SES event record acceptance too. **A lost response or crash before either acceptance record still permits duplicate delivery on retry.** Exactly-once sending cannot be guaranteed.
- Cancellation is accepted only before the worker's transactional send claim. Once sending begins, cancellation throws even if status still says `queued`. This avoids promising cancellation while AWS may already be receiving the request.
- SNS redelivery of the same notification ID is deduplicated transactionally; separate SNS notifications can still describe the same provider event. Keep app-side effects idempotent. Callbacks use the callback registered when the email was created.
- Events expose AWS's `eventType`/`mail` payload rather than Resend's `email.*` payload. Provider IDs are `sesMessageId`. Status and tracking flags otherwise keep the familiar interface.
- Queued input is capped at 128 KiB and 50 recipients per email to fit Convex's transaction/action limits. Use `sendEmailManually` in an action for larger bodies/attachments; its callback owns the actual AWS request and must honor the declared destinations/configuration set.
- Rate limiting coordinates this component instance. Other senders or additional mounts share AWS's account quotas but not this limiter. AWS can accept below its stated maximum, and daily quota exhaustion can outlast the configured retry window.

## Troubleshooting

| Symptom | Check / action |
| --- | --- |
| AWS AccessDenied / invalid signature | Use AWS API access keys, not SMTP credentials. Verify IAM resources, correct region, active key, and session token if temporary. |
| Email identity not verified | Identity and send region must match. Check domain DNS, more-specific email identities, and SES account status. |
| PendingConfirmation | Deploy `/ses-webhook` first, set the exact topic ARN, use `.convex.site`, and request subscription confirmation again. |
| SNS webhook 400 | Keep raw delivery off. Verify allowed topic ARN, AWS SNS signature version and certificate URL. Unsigned hand-written requests are expected to fail. |
| SNS webhook 503 | Event may have arrived before acceptance was recorded. SNS retries automatically. A dedicated topic avoids unknown email events from other apps. |
| `sent` but never `delivered` | Attach the configuration set to every send (including manual calls); check destination Enabled/types, SNS policy/KMS permission, confirmed subscription and callback failures. |
| Throttling / quota exceeded | Lower `AWS_SES_MAX_SEND_RATE`; account for all applications, recipients and daily quota. Inspect whether retries exhausted before the quota reset. |
| Template rejected / rendering failure | Verify template exists in the same region and required data exists. Do not mix template and html/text. Ensure IAM permits the template resource. |
| Test-mode rejection | Use simulator destinations in To/CC/BCC. Only disable test mode when deliberately sending to a real recipient. |
| `cancelEmail` throws while queued | Sending was already claimed. The API intentionally refuses to promise a cancellation at that point. |
| Verification times out | Open the JSON evidence, component emails/events/workpool tables, Convex logs, and SNS delivery logs. Fix the cause and run a new smoke test; do not repeatedly resend production messages. |

When asking for help, share the deployment name, region, component email ID, error class/message, and redacted smoke evidence. Do not share AWS secret keys, session tokens, Convex deploy keys, message contents, or authentication links.
