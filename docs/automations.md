# Automation runtime

The dashboard automation list, builder, test-event dialog and observability
screen use Convex. The existing `POST /events/send` route starts runs through
the custom-event outbox consumer. Inbound WhatsApp messages also emit the system
event `opensend:whatsapp.message.received`, with a contact ID and message payload,
so phone-only contacts can start runs without an email address.

## Stored definitions and execution

- `automations` stores the team's definition, status and deletion fence. Graphs
  retain the dashboard tree shape, encoded as JSON and structurally validated
  before storage: at most 100 steps, 12 branch levels and 64 KiB. Empty drafts
  can be saved; enabling checks the trigger and all step prerequisites.
- `automationEventLinks` indexes trigger/wait references for the Events screen.
- `automationRuns` snapshots the graph and trigger payload, links the contact
  and workflow, and records status and the current event wait.
- `automationRunSteps` stores each reached step separately. Definitions bound
  a run to 101 records including the trigger. Counters and duration sums update
  in the same transaction as writes; metrics include all matching runs, not
  only the currently loaded page.

Every run uses the mounted `@convex-dev/workflow` component. Delays use durable
sleep. Event waits register the contact, event name and deadline transactionally;
a matching event or scheduled timeout signals the workflow once. Events resume
only waiting runs belonging to the same team and contact. Event dispatch pages
through both waiting runs and enabled automations. Starting from the same outbox
event is idempotent per automation. Unknown email addresses become contacts only
when an enabled automation actually starts a run.

The builder supports condition, delay, wait for event, send email, send WhatsApp,
update contact, delete contact and add to segment. Conditions use the
shared comparison helpers and read current contact values. The `event.*` scope
continues to mean the original trigger payload after a wait; the matching payload
is retained in the wait step's output. Audience writes use the shared helpers,
including their contact webhooks.

## Sending and lifecycle

Send steps render the current published template, resolve event/contact variables,
and pass the result through `emails.createEmail`. From overrides use the sender
pipeline's verified-domain and tenant checks; free-text reply-to overrides must
also belong to a verified domain of the team. Deleted or unsubscribed contacts
are skipped when the step executes. The shared pipeline checks suppressions.
Templates containing `OPENSEND_UNSUBSCRIBE_URL` get recipient-specific links and
RFC 8058 headers from `unsubscribeLinks`.

A completed send step means the email was accepted by the durable sending
pipeline, not that SES delivered it. Its output contains the email ID. Subsequent
SES outcomes belong to the email's status/history.

`send_whatsapp` uses the shared `channels.messages.createChannelMessage` pipeline
with `source: "automation"` and an automation run ID. Its dashboard graph stores
`accountId`, `mode: "template" | "text"`, `templateId` or `text`, and `variables`.
REST config uses `account_id` and `template_id`; SDK and MCP config uses camelCase.
Variable mappings accept literal strings, `{ contact: "firstName" | "lastName" |
"email" | "phone", fallback? }`, `{ property: "key", fallback? }`, or
`{ value: "text", fallback? }`. The account and approved template must belong to
the same team and WABA. The runtime records `no_phone` or `window_closed` skips,
and respects unsubscribe and marketing opt-outs. Its output contains `message_id`.
Phone-only runs skip email steps and continue along the workflow.

Disabling stops future starts and lets existing snapshots finish, matching the
existing dashboard copy. Deleting immediately fences all steps, then cancels
workflows and removes runs, steps, references and aggregate entries in bounded
batches. Stopping an individual run cancels its workflow and marks active steps
cancelled. These operations cannot retract a message already handed to the
sending pipeline. Workflow journals persist for live run history and are cleaned
up on automation deletion.

The trigger picker offers custom events and a System events group with WhatsApp
message received. `wait_for_event` accepts that same system event to wait for a
reply from the contact. Reserved system names cannot be created through the
custom event API.
Remove-from-segment and topic steps, wait-event variable selectors and an export
button are absent, so this lane does not add them or change the UI to expose them.
The shared dashboard topic mutation now emits `contact.updated` when its choice
changes, consistent with the recipient preference page.

## Verification and operations

The tests register the real workflow, workpool and aggregate components in
`convex-test`. AWS calls are mocked. Coverage includes authorization, schema and
payload rejection, branch order, durable delay/resumption, workflow journal
replay, event matching/timeouts, paginated fanout, cancellation and deletion,
audience events, SES tenant binding, suppressions and unsubscribe behavior.
`convex/whatsappCampaigns.test.ts` covers WhatsApp campaigns and automations;
`tests/e2e/whatsapp-campaigns-flow.ts` drives the real builder and campaign form
against the fake Graph server and saves form, report and builder screenshots.

New aggregates are mounted in `convex.config.ts`; the normal count backfill
includes automations, runs and steps. No codegen, backend deployment, live AWS
operations or browser E2E suite were run in this lane.

References checked against the existing UI's scope:

- [Resend automations](https://resend.com/docs/dashboard/automations/introduction)
- [Trigger and step reference](https://resend.com/docs/dashboard/automations/steps)
- [Run observability](https://resend.com/docs/dashboard/automations/runs)
- [Update automation](https://resend.com/docs/api-reference/automations/update-automation)
- [Send event](https://resend.com/docs/api-reference/events/send-event)
- [Convex workflow](https://github.com/get-convex/workflow)
