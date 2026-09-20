# Amazon SES Convex Component

This component integrates the Amazon SES email service with your Convex project.
It has the same shape and developer experience as the official
[Resend component](https://github.com/get-convex/resend), adapted to SES.

Start with [RUNBOOK.md](./RUNBOOK.md) for new AWS accounts or existing SES setups,
including domain verification, IAM, SNS, Convex, and automated live checks.
See [REVIEW.md](./REVIEW.md) for the review findings and verification limits.

Features:

- Transactional enqueueing with durable workpool execution and bounded retries.
- Batching of compatible templates through SESv2 `SendBulkEmail`.
- Enqueue-time deduplication through `idempotencyKey`.
- Shared recipient-based rate reservations, including retries.
- SNS signature verification, topic allowlisting, notification deduplication,
  delivery tracking, callbacks, cancellation, and bounded retention cleanup.

SES has no send-time idempotency key. Accepted responses are recorded immediately,
and a reserved message tag lets early SNS events record acceptance too. A lost
response or crash before recording acceptance can still result in duplicate sends
on retry. This is **not an exactly-once delivery guarantee**. Retry exhaustion
and permanent failures are reported in email status.

See `example/` for a demo of how to incorporate this component into your
application.

## Installation

```sh
npm install @k4stack/ses
```

## Get Started

Create an IAM user (or role) that is allowed to send with SES and nothing else,
then create an access key for it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ses:SendEmail", "ses:SendBulkEmail"],
      "Resource": [
        "arn:aws:ses:us-east-1:123456789012:identity/example.com",
        "arn:aws:ses:us-east-1:123456789012:configuration-set/your-config-set",
        "arn:aws:ses:us-east-1:123456789012:template/*"
      ]
    }
  ]
}
```

Set `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in your
Convex deployment environment. Verify a sending identity (domain or address) in
the SES console for that region.

Next, add the component to your Convex app via `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server"
import ses from "@k4stack/ses/convex.config"

const app = defineApp()
app.use(ses)

export default app
```

Then you can use it, as we see in `convex/sendEmails.ts`:

```ts
import { components } from "./_generated/api"
import { SES } from "@k4stack/ses"
import { internalMutation } from "./_generated/server"

export const ses: SES = new SES(components.ses, {})

export const sendTestEmail = internalMutation({
  handler: async (ctx) => {
    await ses.sendEmail(ctx, {
      from: "Me <test@mydomain.com>",
      to: "success@simulator.amazonses.com",
      subject: "Hi there",
      html: "This is a test email",
    })
  },
})
```

Then, calling `sendTestEmail` from anywhere in your app will send this test
email.

If you want to send emails to real addresses, you need to disable `testMode`.
You can do this in `SESOptions`, as detailed below. Note that while your AWS
account is in the SES sandbox, SES itself only delivers to verified identities
and the mailbox simulator.

A note on test email addresses: the component only allows
[Amazon SES mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html)
addresses in test mode: `success@`, `bounce@`, `ooto@`, `complaint@`, and
`suppressionlist@simulator.amazonses.com`. SES supports labels; for simplicity
this component only allows labels matching `[a-zA-Z0-9_-]*`, e.g.
`bounce+order-1@simulator.amazonses.com`.

## Advanced Usage

### Setting up event tracking (SNS webhook)

After configuring sending, you don't have any
feedback on anything delivering, bouncing, or triggering spam complaints. For
that, we need SES to publish events to an SNS topic that calls our webhook.

On the Convex side, mount an http endpoint that routes to the component in
`convex/http.ts`:

```ts
import { httpRouter } from "convex/server"
import { httpAction } from "./_generated/server"
import { ses } from "./sendEmails"

const http = httpRouter()

http.route({
  path: "/ses-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    return await ses.handleSesEventWebhook(ctx, req)
  }),
})

export default http
```

If our Convex project is happy-leopard-123, we now have a webhook running at
`https://happy-leopard-123.convex.site/ses-webhook`.

Then, in AWS:

1. Create an SNS topic (e.g. `ses-events`). Copy its ARN and set it as the
   `AWS_SES_SNS_TOPIC_ARN` environment variable in your Convex deployment. The
   webhook rejects messages from any other topic.
2. Create an SES configuration set (e.g. `default`) and set it as
   `AWS_SES_CONFIGURATION_SET`. Add an event destination of type Amazon SNS
   pointing at the topic, and enable all the event types you care about
   (sends, deliveries, bounces, complaints, rejects, rendering failures,
   delivery delays, opens, clicks).
3. Subscribe the topic to your webhook URL with protocol HTTPS. The component
   verifies the SNS signature and confirms the subscription automatically.

You should now be seeing email status updates as SES makes progress on your
batches!

Speaking of...

### Registering an email status event handler

If you have your webhook established, you can also register an event handler
in your app so you get notifications when email statuses change.

Update your `sendEmails.ts` to look something like this:

```ts
import { components, internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"
import { SES, vOnEmailEventArgs } from "@k4stack/ses"

export const ses: SES = new SES(components.ses, {
  onEmailEvent: internal.sendEmails.handleEmailEvent,
})

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    // Handle however you want
    // args provides { id: EmailId; event: EmailEvent }
    // event.eventType is one of "Send" | "Delivery" | "Bounce" | "Complaint" |
    // "Reject" | "Open" | "Click" | "Rendering Failure" | "DeliveryDelay" |
    // "Subscription", with the full SES record under event.mail etc.
    // see /example/convex/example.ts
  },
})
```

Check out the `example/` project in this repo for a full demo.

### SES component options, and going into production

There is an `SESOptions` argument to the component constructor to help
customize its behavior.

Check out the docstrings, but notable options include:

- `region`, `credentials`: Provide the AWS region and credentials instead of
  having them read from `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY` (and optionally `AWS_SESSION_TOKEN`).
- `snsTopicArn`: The topic(s) your webhook accepts events from, instead of
  `AWS_SES_SNS_TOPIC_ARN`.
- `configurationSetName`: The default configuration set to send with, instead
  of `AWS_SES_CONFIGURATION_SET`. Can be overridden per email.
- `maxSendRate`: Your account's SES maximum send rate, in emails per second.
  Defaults to 1 (the sandbox limit). Set it to the value shown in the SES
  console once you are out of the sandbox, or the component will send much
  slower than it could.
- `testMode`: Only allow delivery to mailbox simulator addresses. To keep you
  safe as you develop your project, `testMode` is default **true**. You need to
  explicitly set this to `false` for the component to allow you to enqueue
  emails to arbitrary addresses.
- `onEmailEvent`: Your email event callback, as outlined above!

### Optional email sending parameters

In addition to basic from/to/subject and html/plain text bodies, the
`sendEmail` method allows you to provide `cc`, `bcc`, a list of `replyTo`
addresses, custom `headers`, SES message `tags` (published with every event),
and a per-email `configurationSetName`.

### Enqueue-time idempotency

SES does not support send-time idempotency keys. Retries skip accepted responses
already recorded, but lost responses or a crash before recording can still cause
duplicates. The reserved `convex-email-id` tag allows early events to record
acceptance and reduce that window.

To dedupe at enqueue time, pass an `idempotencyKey`. If an email with the same
key has already been enqueued, `sendEmail` returns the existing `EmailId`
instead of enqueuing (and delivering) a duplicate:

```ts
const emailId = await ses.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "success@simulator.amazonses.com",
  subject: "Order confirmation",
  html: "...",
  // Derive this from the triggering event so retries collapse to one send.
  idempotencyKey: `order-confirmation:${orderId}`,
})
```

Because `sendEmail` runs in a transactional mutation, concurrent enqueues with
the same key are safe: one wins and the others receive its `EmailId`.

### Using SES templates

You can use [SES templates](https://docs.aws.amazon.com/ses/latest/dg/send-personalized-email-api.html)
to send emails with pre-designed templates. Reference a stored template by
`name` (or `arn`), or provide the template inline with `content`. `data` holds
the values for the template's `{{variables}}`:

```ts
await ses.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "success@simulator.amazonses.com",
  template: {
    name: "welcome-email",
    data: {
      name: "John Doe",
      verificationLink: "https://example.com/verify?token=abc123",
    },
  },
})

await ses.sendEmail(ctx, {
  from: "Me <test@mydomain.com>",
  to: "success@simulator.amazonses.com",
  template: {
    content: {
      subject: "Welcome, {{name}}!",
      html: "<p>Thanks for joining, {{name}}.</p>",
      text: "Thanks for joining, {{name}}.",
    },
    data: { name: "John Doe" },
  },
})
```

Templated emails in the same batch that share a sender, reply-to addresses,
configuration set, and template are sent together with one `SendBulkEmail`
call.

> **Important**
>
> You cannot use both `template` and `html`/`text` in the same email, and the
> template defines the subject. If you need to send dynamic HTML content,
> either use templates with template data, or use the `html`/`text` fields
> directly (optionally with React Email).

### Tracking, getting status, and cancelling emails

The `sendEmail` method returns a branded type, `EmailId`. You can use this for
a few things:

- To reassociate the original email during status changes in your email event
  handler.
- To check on the status any time using `ses.status(ctx, emailId)`.
- To cancel the email using `ses.cancelEmail(ctx, emailId)`.

Once the worker claims a send, cancellation is refused, even while status is `queued`.
Cancellations do not trigger an email event.

#### Checking email status programmatically

Use the `status` method to check an email's current state:

```ts
const emailStatus = await ses.status(ctx, emailId)
if (emailStatus) {
  console.log(emailStatus.status) // e.g., "delivered", "bounced", "sent"
  console.log(emailStatus.sesMessageId) // the ID Amazon SES assigned (string | null)
  console.log(emailStatus.bounced) // boolean
  console.log(emailStatus.failed) // boolean
  console.log(emailStatus.complained) // spam complaint (boolean)
  console.log(emailStatus.deliveryDelayed) // boolean
  console.log(emailStatus.opened) // if open tracking enabled (boolean)
  console.log(emailStatus.clicked) // if click tracking enabled (boolean)
  console.log(emailStatus.errorMessage) // error details (string | null)
}
```

#### Viewing emails and events in the dashboard

You can view all email data directly in your Convex dashboard in the
component's data view. Choose `ses` from the component drop down, then:

1. **Emails table**: All emails with their current status, recipients,
   subjects, SES message IDs, and tracking information.
2. **Delivery Events table**: Every SES event received, including:
   - `emailId`: Links back to the email in the emails table
   - `sesMessageId`: Amazon SES's ID for the email
   - `eventType`: The type of event (e.g., `Delivery`, `Bounce`, `Open`,
     `Click`, `Complaint`)
   - `createdAt`: When the event occurred
   - `message`: Additional details (e.g., bounce diagnostic codes)

### Data retention

This component retains "finalized" (delivered, cancelled, bounced, failed)
emails. It's your responsibility to clear out those emails on your own
schedule. You can run `cleanupOldEmails` and `cleanupAbandonedEmails` from the
dashboard, under the "ses" component tab in the function runner, or set up a
cron job.

If you pass no argument, it defaults to deleting emails older than 7 days.

If you don't care about historical email status, the recommended approach is to
use a cron job, as shown below:

```ts
// in convex/crons.ts
import { cronJobs } from "convex/server"
import { v } from "convex/values"
import { components, internal } from "./_generated/api"
import { internalMutation } from "./_generated/server"

const crons = cronJobs()
crons.interval(
  "Remove old emails from the ses component",
  { hours: 1 },
  internal.crons.cleanupSes
)

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000
export const cleanupSes = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, components.ses.lib.cleanupOldEmails, {
      olderThan: ONE_WEEK_MS,
    })
    await ctx.scheduler.runAfter(
      0,
      components.ses.lib.cleanupAbandonedEmails,
      // These generally indicate a bug, so keep them around for longer.
      { olderThan: 4 * ONE_WEEK_MS }
    )
    return null
  },
})

export default crons
```

### Using React Email

You can use [React Email](https://react.email/) to generate your HTML for you
from JSX.

First install the dependencies:

```sh
npm install @react-email/components react react-dom react-email @react-email/render
```

Then create a new .tsx file in your Convex directory e.g. `/convex/emails.tsx`:

```tsx
// IMPORTANT: this is a Convex Node Action
"use node"
import { action } from "./_generated/server"
import { render, pretty } from "@react-email/render"
import { Button, Html } from "@react-email/components"
import { components } from "./_generated/api"
import { SES } from "@k4stack/ses"

export const ses: SES = new SES(components.ses, {
  testMode: false,
})

export const sendEmail = action({
  args: {},
  handler: async (ctx) => {
    // 1. Generate the HTML from your JSX
    const html = await pretty(
      await render(
        <Html>
          <Button
            href="https://example.com"
            style={{ background: "#000", color: "#fff", padding: "12px 20px" }}
          >
            Click me
          </Button>
        </Html>
      )
    )

    // 2. Send your email as usual using the component
    await ses.sendEmail(ctx, {
      from: "Me <test@mydomain.com>",
      to: "success@simulator.amazonses.com",
      subject: "Hi there",
      html,
    })
  },
})
```

> **Warning**
>
> React Email requires some Node dependencies thus it must run in a Convex
> [Node action](https://docs.convex.dev/functions/runtimes#nodejs-runtime) and
> not a regular Action.

### Sending emails manually, e.g. for attachments

If you need something that the component doesn't provide (for example
attachments via a raw MIME message), you can send emails manually using
`sendEmailManually`. Unlike `sendEmail`, which enqueues emails and sends them in
batches, `sendEmailManually` lets you call the SES API yourself while the
component still tracks the email's progress using its status and webhook APIs.
Return the `MessageId` SES gives you so events can be matched back to the
email.

```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2"
import { components } from "./_generated/api"
import { internalAction } from "./_generated/server"
import { SES } from "@k4stack/ses"

const client = new SESv2Client({
  region: process.env.AWS_REGION,
  maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
})

export const ses = new SES(components.ses, {})

export const sendManualEmail = internalAction({
  args: {},
  handler: async (ctx) => {
    const from = "Acme <onboarding@mydomain.com>"
    const to = ["success@simulator.amazonses.com"]
    const subject = "hello world"

    const emailId = await ses.sendEmailManually(
      ctx,
      { from, to, subject },
      async (emailId) => {
        const response = await client.send(
          new SendEmailCommand({
            FromEmailAddress: from,
            ConfigurationSetName: process.env.AWS_SES_CONFIGURATION_SET,
            EmailTags: [{ Name: "convex-email-id", Value: emailId }],
            Destination: { ToAddresses: to },
            Content: {
              Simple: {
                Subject: { Data: subject },
                Body: { Html: { Data: "<p>it works!</p>" } },
                Headers: [{ Name: "X-Email-Id", Value: emailId }],
              },
            },
          })
        )
        if (!response.MessageId)
          throw new Error("[Email] SES returned no MessageId")
        return response.MessageId
      }
    )
  },
})
```

Use `sendEmailManually` when you need features not supported by the batching
system, such as attachments or raw messages, or when you want to send an email
immediately without waiting for the batching system.

## How it maps to Amazon SES

| Concept           | Resend component              | This component                                                                                                             |
| ----------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API               | `/emails/batch`               | SESv2 `SendEmail`, `SendBulkEmail` (templates)                                                                             |
| Exactly-once      | `Idempotency-Key` header      | Enqueue dedupe; recorded accepts skipped; duplicates remain possible                                                                         |
| Rate limit        | Fixed window, 1 call / 600 ms | Shared recipient reservations on every attempt                                                                            |
| Webhook           | Svix-signed HTTP POST         | SNS HTTPS subscription, signature verified                                                                                 |
| Test addresses    | `*@resend.dev`                | `*@simulator.amazonses.com`                                                                                                |
| Provider email id | `resendId`                    | `sesMessageId`                                                                                                             |
| Event types       | `email.*`                     | `Send`, `Delivery`, `Bounce`, `Complaint`, `Reject`, `Open`, `Click`, `Rendering Failure`, `DeliveryDelay`, `Subscription` |

## Compatibility and operational limits

The familiar constructor, send/status/get/cancel/manual methods, callback helper,
validators, and cleanup entry points are retained. `template: { id, variables }`
is accepted, with `id` mapped to an SES template name; native SES template options
are also available. SES renders the template subject, so a separate subject is
ignored. AWS credentials, SNS setup, `sesMessageId`, and AWS event payloads are
provider-specific. See the runbook for the complete compatibility notes.

`AWS_SES_MAX_SEND_RATE` can set the default recipient rate; constructor
`maxSendRate` takes precedence. Rates must be finite and at least 1. Retry attempts
must be integers from 1 to 20. Queued input is limited to 128 KiB and 50 recipients
across To/CC/BCC. Prefer one recipient per transactional email.

Manual sends check declared recipients in test mode, but the callback controls
the real request, pacing and retries. Include the configuration set in that
request to receive events. Callback routing is saved per email. Your app owns
recipient authorization, contact suppression, and business-event idempotency.

Private execution metadata stores AWS credentials for background sending; it is
not returned by `get` or `status`. Protect deployment/admin access and account for
queued work during credential rotation. Idempotency keys expire when retention
cleanup deletes their email records.
