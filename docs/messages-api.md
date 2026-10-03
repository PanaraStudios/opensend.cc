# Unified Messages API

Send and read email, WhatsApp, Messenger and Instagram through `/messages` on your Opensend API origin. It uses the same senders, validation, queues, window rules and idempotency as `/emails` and the existing channel routes.

```ts
const email = await opensend.messages.send({
  channel: 'email',
  from: 'Support <support@example.com>',
  to: 'customer@example.com',
  subject: 'Your order',
  text: 'Your order has shipped.',
}, { idempotencyKey: 'order-email-42' });

const whatsapp = await opensend.messages.send({
  channel: 'whatsapp',
  from: 'channel-account-id',
  to: '16505551234',
  template: { alias: 'order_shipped', variables: { order: '42' } },
}, { idempotencyKey: 'order-whatsapp-42' });

const message = await opensend.messages.get(whatsapp.data!.id);
```

`POST /messages` returns `{id}`. The common envelope accepts `to`, optional `from`, `template` (exactly one `id` or `alias`, with optional `variables`), `text`, `media`, `reply_to` and `tags`. Email also accepts `subject` and `html`. Email `to` and `reply_to` accept a string or array; Meta accepts a string. `from` is an email address for email and an account id or external channel identifier for Meta; it can be omitted when the existing sender can resolve it unambiguously.

Meta sends require exactly one text, template or nonempty media body. Free-form sends require the channel's open conversation window; WhatsApp templates must be approved. Template variables are rendered by the existing sender, and `preview` includes the rendered body when available. Errors retain the existing `{statusCode, name, message}` contract, including readable `validation_error` messages.

Email media uses the existing attachment fields: `{id}` for a completed email upload, or `{url, filename}` (or `{path, filename}`) / `{content, filename}` for a URL / base64 attachment, with optional `content_type`. Meta media accepts one `{type: 'image' | 'video' | 'audio' | 'file', id | url}` item. Upload ids must be ready and authorized for that channel. `reply_to` means reply addresses for email and the prior message id for Meta. Tags are `{name, value}` pairs.

`Idempotency-Key` is a header, or `idempotencyKey` in SDK request options / MCP input. The same request replays its response for 24 hours. Changing its body or endpoint with the same key returns 409. Scopes are checked on replay too.

`GET /messages` returns `{object: 'list', data, has_more, next_cursor}`. Each row has `id`, `object: 'message'`, `channel`, `direction`, `from`, `to`, `status`, `preview`, `created_at` and nullable `contact_id`. Meta adds `conversation_id` and normalized content; email adds `subject`, `html` and `text`. Email recipients stay an array, preserving multiple recipients. Email `contact_id` identifies the primary recipient's CRM contact, or the sender's contact for received email; it is null when unlinked.

Filters are `channel`, `direction`, `status`, `contact_id`, `from`, `to`, `created_after` and `created_before`. Address filters match exactly; email `to` matches any recipient in the `to` array. Creation bounds are inclusive ISO 8601 timestamps. `limit` defaults to 20, maximum 100.

```ts
let cursor: string | undefined;
do {
  const page = await opensend.messages.list({ direction: 'outbound', limit: 20, cursor });
  if (page.error) throw new Error(page.error.message);
  for (const message of page.data!.data) console.log(message.channel, message.preview);
  cursor = page.data!.next_cursor ?? undefined;
} while (cursor);
```

Lists merge sent email, received email and Meta messages by creation time, newest first, with an id tie-break. Continue with `cursor=next_cursor` and identical filters and readable channels. Cursors do not depend on the anchor row continuing to exist. Newer inserts do not shift later pages. Bounded scans can return short or empty pages while `has_more` is true; continue until `next_cursor` is null. The merged list uses opaque cursors rather than `/emails`'s `after` / `before` ids.

Sending requires the selected channel's `emails:write`, `whatsapp:write`, `messenger:write` or `instagram:write` scope. A Custom key with only `whatsapp:write` can send WhatsApp and read WhatsApp (write implies read). Legacy Sending access remains email-only. Listing without a channel returns only readable channels; an explicit channel filter requires that channel's read scope. Getting an id requires its stored channel's read scope. Full access covers all channels, and tenant isolation applies to every operation.

Email events and `<channel>.message.*` webhooks add the common message fields while retaining existing event-specific fields such as `email_id`, `message_id`, `tags`, delivery details and normalized channel content. Event names remain in the existing shared webhook catalog.

MCP exposes `send_message`, `list_messages` and `get_message`. Existing email and channel tools remain available. The complete contract is in [opensend.yaml](../openapi/opensend.yaml).
