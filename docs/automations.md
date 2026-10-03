# Automation runtime

The dashboard automation list, builder, test-event dialog and observability
screen use Convex. The existing `POST /events/send` route starts runs through
the custom-event outbox consumer. All system events use the same outbox row as webhooks. The automation catalog
includes every email, WhatsApp, Messenger, Instagram, calling, contact, note,
domain and suppression event; phone-only contacts can start runs without email.

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

The trigger picker groups all system and team custom events by channel.
`wait_for_event` accepts any catalog event. Contact events resume matching
contact waits; contactless events resume contactless waits within the team. Reserved system names cannot be created through the
custom event API.
Remove-from-segment, topic, and HTTP webhook action blocks are outside the
existing automation step model. Catalog variables are available in all supported
step text fields, including conditions, event waits, templates and delays.
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

## System events and mapping between steps

`GET /events/catalog` (scope `events:read`) returns every webhook event and the
team's custom events, with labels, groups, descriptions and nested schemas.
Each field declares a type, example and description. Objects have `fields`;
arrays have `items`. Optional and nullable fields describe provider variations.
`contact.properties` lists that team's property definitions. Provider extension
objects retain their original values. `dynamic` identifies provider-defined JSON;
`valueTypes` describes wire fields that accept multiple types. Nested WhatsApp
fields derive from the existing SDK wire schemas, including interactive replies,
shared contacts, media and orders. The catalog is shared with the SDK.

System triggers use `opensend:<webhook event name>`, for example
`opensend:whatsapp.message.received`, `opensend:instagram.message.received`,
`opensend:email.opened`, and `opensend:whatsapp.call.completed`. The existing
`contact.note_created` trigger retains its unprefixed name. Its payload includes
`body`, `author.kind`, `author.id`, `author.name`, optional `source.call_id`,
`source.conversation_id`, `source.message_id`, timestamps and the contact.
Custom names
remain unchanged, including a custom event called `email.opened`. Custom events
cannot claim the reserved `opensend:` prefix. Both automation and webhook
consumers receive the same internal outbox row; inbound projection no longer
creates a second event for automations. Runs deduplicate by team, automation
and outbox event id. Contactless events such as domain changes can run flow
steps; contact-dependent steps require a contact.

Trigger config accepts `filters`, an AND list of the same rules used by a
Condition step. Filters can select an account, message type, text or call
outcome. The builder uses the same condition editor for filters.

```json
{
  "name": "Reply to price enquiries",
  "status": "enabled",
  "steps": [
    {
      "key": "start",
      "type": "trigger",
      "config": {
        "event_name": "opensend:whatsapp.message.received",
        "filters": [
          {
            "type": "rule",
            "field": "trigger.message.text",
            "operator": "contains",
            "value": "price"
          }
        ]
      }
    },
    {
      "key": "reply",
      "type": "send_whatsapp",
      "config": {
        "account_id": "your-account-id",
        "mode": "text",
        "text": "Hi {{contact.first_name}}, you asked: {{trigger.message.text}}"
      }
    }
  ],
  "connections": [{ "from": "start", "to": "reply", "type": "default" }]
}
```

All step text fields accept `{{trigger.<path>}}`, `{{steps.<stepKey>.<path>}}`
and `{{contact.<path>}}`. Arrays use `.0` or `[0]`. Whole tokens retain types in
condition operands and email template variables; text inputs interpolate as strings. Missing values become
empty strings; channel variable `{ value: "{{trigger.text}}", fallback: "..." }`
provides an optional fallback. Values inserted into email HTML are escaped.
The pure resolver executes no code and refuses prototype traversal. Legacy
`event.plan` and `contact.first_name` values continue to work.

Send steps output `message_id` and `status: "queued"` (email also keeps
`email_id` and `to`). Wait steps expose the received payload directly and as
`payload`, plus `event_received`. Contact updates output `contact`; conditions
output `condition_met` and `branch`. Delay steps output `until` and accept an
ISO date or token through the `until` field. Delete and segment steps output
`deleted` and `segment_id`. Outputs are retained on the run's step records.
Run detail exposes `inputs` and `output` in both the dashboard and REST API.

Unknown tokens, inaccessible steps (future steps or a different branch), and
condition type mismatches are rejected on save with `422 validation_error`.
Drafts can still contain blank prerequisites. Step keys should remain stable
when editing references. Variables show only trigger fields, earlier steps on
the current path, and contact fields. The variable picker inserts at the cursor,
shows type and example, and previews interpolation with sample values.

SDK: `await opensend.events.catalog()` returns `{ data, error }`. Trigger types
include `SystemTriggerName`; SDK config uses `eventName` and `filters`.
MCP: `list-event-catalog` lists events or accepts `event` to show one event's fields.
