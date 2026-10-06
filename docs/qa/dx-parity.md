# v2 REST, SDK and MCP parity

Audited on branch `fix/v2-dx-parity`, updated for IVR signing-secret rotation. All 202 registered REST operations are listed below. 196 have SDK methods and MCP tools; six protocol or deprecated alias operations are explicitly exempted in `packages/sdk/test/rest-parity-exceptions.json`. None of the key-authenticated REST routes is dashboard-only or admin-only. Full-access-only operations (API keys, usage and OAuth grants) remain available to integrations.

The route source is `convex/api/http.ts` plus the SMTP registrations in `convex/http.ts`; the base contract lives in `openapi/opensend.yaml`. `convex/api/openapi.ts` enriches that contract with operation descriptions and schema-derived examples without changing fields or behavior. The route audit in `convex/api/openapi.test.ts` captures actual `apiRoute` registrations, including registrations outside `convex/api/`. SDK tests check all request paths and callable inventory methods. MCP tests invoke every tool and alternate route branch through the real SDK, then verify coverage and this table. New routes fail these checks until both bindings are exercised or an exact exception with a reason is added.

## Compatibility conventions

- SDK responses remain `{ data, error, headers }`; MCP operations preserve error names/messages and added tools expose response bodies as both text and structured content. `validation_error`, `not_found`, and `restricted_api_key` are tested for every addition.
- Resource lists use `limit` and either `after` or `before`, returning `{ object: "list", data, has_more }`. Unified `messages.list` uses an opaque `cursor` and adds `next_cursor`. These are distinct server contracts and are kept compatible. Channel SDK account filters retain `phoneNumberId`/`accountId` and serialize to their existing REST names.
- `emails.send/create`, channel `messages.send/create`, and unified `messages.send/create` are equivalent aliases. Conversation `listMessages` aliases `messages`. Hyphenated MCP `send-message`, `get-message`, `list-messages`, `mark-message-read`, and `set-typing` retain the original underscore spellings.
- POST operations support `Idempotency-Key`. All SDK POST wrappers accept optional request options and all MCP POST tools expose idempotencyKey; mutation and error bodies are preserved. PATCH calling remains a separate tool matching the REST verb; use the existing POST update tool for idempotent retries.
- The SDK exports the shared `API_SCOPES`, `API_RESOURCES`, `ApiScope`, and `ApiResource` catalog for Custom API key inputs. Existing `scopes: string[]` inputs remain compatible, and the server validates them. Write implies read.
- Topics, broadcasts and webhooks expose pagination through MCP; webhook events and attempts additionally support before. Topics SDK pagination metadata is additive and optional for older typed fixtures.
- Credential examples use redacted placeholders; token-format patterns are checked separately from the redacted documentation examples.
- Unified message routes declare `full_access` as a static fallback: sends require the selected channel's write scope, reads require the actual message's channel read scope, and lists require at least one readable channel (an explicit channel filter needs its read scope). The table includes the dynamic extension when present.

## Inventory

| Method | Path | Required scope | SDK method | MCP tool | Exception / notes |
| --- | --- | --- | --- | --- | --- |
| GET | `/knowledge-bases` | `knowledge:read` | `knowledgeBases.list` | `list-knowledge-bases` | Covered |
| POST | `/knowledge-bases` | `knowledge:write` | `knowledgeBases.create` | `create-knowledge-base` | Covered |
| GET | `/knowledge-bases/{id}` | `knowledge:read` | `knowledgeBases.get` | `get-knowledge-base` | Covered |
| PATCH | `/knowledge-bases/{id}` | `knowledge:write` | `knowledgeBases.update` | `update-knowledge-base` | Covered |
| DELETE | `/knowledge-bases/{id}` | `knowledge:write` | `knowledgeBases.remove` | `remove-knowledge-base` | Covered |
| GET | `/knowledge-bases/{knowledgeBaseId}/documents` | `knowledge:read` | `knowledgeBases.documents.list` | `list-knowledge-documents` | Covered |
| POST | `/knowledge-bases/{knowledgeBaseId}/documents` | `knowledge:write` | `knowledgeBases.documents.create` | `create-knowledge-document` | Covered |
| GET | `/knowledge-bases/{knowledgeBaseId}/documents/{id}` | `knowledge:read` | `knowledgeBases.documents.get` | `get-knowledge-document` | Covered |
| PATCH | `/knowledge-bases/{knowledgeBaseId}/documents/{id}` | `knowledge:write` | `knowledgeBases.documents.update` | `update-knowledge-document` | Covered |
| DELETE | `/knowledge-bases/{knowledgeBaseId}/documents/{id}` | `knowledge:write` | `knowledgeBases.documents.remove` | `remove-knowledge-document` | Covered |
| GET | `/bot-tools` | `bot_tools:read` | `botTools.list` | `list-bot-tools` | Covered |
| POST | `/bot-tools` | `bot_tools:write` | `botTools.create` | `create-bot-tool` | Covered |
| GET | `/bot-tools/{id}` | `bot_tools:read` | `botTools.get` | `get-bot-tool` | Covered |
| PATCH | `/bot-tools/{id}` | `bot_tools:write` | `botTools.update` | `update-bot-tool` | Covered |
| DELETE | `/bot-tools/{id}` | `bot_tools:write` | `botTools.remove` | `remove-bot-tool` | Covered |
| POST | `/knowledge-bases/{id}/search` | `knowledge:read` | `knowledgeBases.search` | `search-knowledge` | Covered |
| POST | `/bot-tools/{id}/test` | `bot_tools:write` | `botTools.test` | `test-bot-tool` | Covered |
| POST | `/messages` | `full_access`; dynamic `channel:write` | `messages.send`, `messages.create` | `send-message`, `send_message` | Covered |
| GET | `/messages` | `full_access`; dynamic `readable-channels` | `messages.list` | `list-messages`, `list_messages` | Covered |
| GET | `/messages/{id}` | `full_access`; dynamic `message-channel:read` | `messages.get` | `get-message`, `get_message` | Covered |
| GET | `/contacts/{id}/notes` | `contacts:read` | `contacts.notes.list` | `list-contact-notes` | Covered |
| POST | `/contacts/{id}/notes` | `contacts:write` | `contacts.notes.create` | `create-contact-note` | Covered |
| PATCH | `/contacts/{id}/notes/{note_id}` | `contacts:write` | `contacts.notes.update` | `update-contact-note` | Covered |
| DELETE | `/contacts/{id}/notes/{note_id}` | `contacts:write` | `contacts.notes.remove` | `remove-contact-note` | Covered |
| POST | `/emails` | `emails:write` | `emails.create`, `emails.receiving.forward`, `emails.send` | `send-email` | Covered |
| GET | `/emails` | `emails:read` | `emails.list` | `list-emails` | Covered |
| POST | `/emails/batch` | `emails:write` | `batch.create` | `send-batch-emails` | Covered |
| GET | `/emails/{id}` | `emails:read` | `emails.get` | `get-email` | Covered |
| PATCH | `/emails/{id}` | `emails:write` | `emails.update` | `update-email` | Covered |
| POST | `/emails/{id}/cancel` | `emails:write` | `emails.cancel` | `cancel-email` | Covered |
| POST | `/emails/{email_id}/share` | `emails:write` | `emails.share` | `share-email` | Covered |
| POST | `/domains` | `domains:write` | `domains.create` | `create-domain` | Covered |
| GET | `/domains` | `domains:read` | `domains.list` | `list-domains` | Covered |
| GET | `/domains/{id}` | `domains:read` | `domains.get` | `get-domain` | Covered |
| PATCH | `/domains/{id}` | `domains:write` | `domains.update` | `update-domain` | Covered |
| DELETE | `/domains/{id}` | `domains:write` | `domains.remove` | `remove-domain` | Covered |
| POST | `/contacts` | `contacts:write` | `contacts.create` | `create-contact` | Covered |
| GET | `/contacts` | `contacts:read` | `contacts.list` | `list-contacts` | Covered |
| GET | `/contacts/{id}` | `contacts:read` | `contacts.get` | `get-contact` | Covered |
| PATCH | `/contacts/{id}` | `contacts:write` | `contacts.update` | `update-contact` | Covered |
| DELETE | `/contacts/{id}` | `contacts:write` | `contacts.remove` | `remove-contact` | Covered |
| POST | `/segments` | `segments:write` | `segments.create` | `create-segment` | Covered |
| GET | `/segments` | `segments:read` | `segments.list` | `list-segments` | Covered |
| GET | `/segments/{id}` | `segments:read` | `segments.get` | `get-segment` | Covered |
| PATCH | `/segments/{id}` | `segments:write` | `segments.update` | `update-segment` | Covered |
| DELETE | `/segments/{id}` | `segments:write` | `segments.remove` | `remove-segment` | Covered |
| POST | `/topics` | `topics:write` | `topics.create` | `create-topic` | Covered |
| GET | `/topics` | `topics:read` | `topics.list` | `list-topics` | Covered |
| GET | `/topics/{id}` | `topics:read` | `topics.get` | `get-topic` | Covered |
| PATCH | `/topics/{id}` | `topics:write` | `topics.update` | `update-topic` | Covered |
| DELETE | `/topics/{id}` | `topics:write` | `topics.remove` | `remove-topic` | Covered |
| POST | `/contact-properties` | `contacts:write` | `contactProperties.create` | `create-contact-property` | Covered |
| GET | `/contact-properties` | `contacts:read` | `contactProperties.list` | `list-contact-properties` | Covered |
| GET | `/contact-properties/{id}` | `contacts:read` | `contactProperties.get` | `get-contact-property` | Covered |
| PATCH | `/contact-properties/{id}` | `contacts:write` | `contactProperties.update` | `update-contact-property` | Covered |
| DELETE | `/contact-properties/{id}` | `contacts:write` | `contactProperties.remove` | `remove-contact-property` | Covered |
| POST | `/templates` | `templates:write` | `templates.create` | `create-template` | Covered |
| GET | `/templates` | `templates:read` | `templates.list` | `list-templates` | Covered |
| GET | `/templates/{id}` | `templates:read` | `templates.get` | `get-template` | Covered |
| PATCH | `/templates/{id}` | `templates:write` | `templates.update` | `update-template` | Covered |
| DELETE | `/templates/{id}` | `templates:write` | `templates.remove` | `remove-template` | Covered |
| POST | `/broadcasts` | `broadcasts:write` | `broadcasts.create` | `create-broadcast` | Covered |
| GET | `/broadcasts` | `broadcasts:read` | `broadcasts.list` | `list-broadcasts` | Covered |
| GET | `/broadcasts/{id}` | `broadcasts:read` | `broadcasts.get` | `get-broadcast`, `update-broadcast` | Covered |
| PATCH | `/broadcasts/{id}` | `broadcasts:write` | `broadcasts.update` | `update-broadcast` | Covered |
| DELETE | `/broadcasts/{id}` | `broadcasts:write` | `broadcasts.remove` | `remove-broadcast` | Covered |
| POST | `/events` | `events:write` | `events.create` | `manage-events` | Covered |
| GET | `/events` | `events:read` | `events.list` | `manage-events` | Covered |
| GET | `/events/{id}` | `events:read` | `events.get` | `manage-events` | Covered |
| PATCH | `/events/{id}` | `events:write` | `events.update` | `manage-events` | Covered |
| DELETE | `/events/{id}` | `events:write` | `events.remove` | `manage-events` | Covered |
| POST | `/domains/{id}/verify` | `domains:write` | `domains.verify` | `verify-domain` | Covered |
| POST | `/api-keys` | `full_access` | `apiKeys.create` | `create-api-key` | Covered |
| GET | `/api-keys` | `full_access` | `apiKeys.list` | `list-api-keys` | Covered |
| DELETE | `/api-keys/{id}` | `full_access` | `apiKeys.remove` | `remove-api-key` | Covered |
| PATCH | `/api-keys/{id}` | `full_access` | `apiKeys.update` | `update-api-key` | Covered |
| POST | `/templates/{id}/publish` | `templates:write` | `templates.publish` | `publish-template` | Covered |
| POST | `/templates/{id}/duplicate` | `templates:write` | `templates.duplicate` | `duplicate-template` | Covered |
| POST | `/broadcasts/{id}/send` | `broadcasts:write` | `broadcasts.send` | `send-broadcast` | Covered |
| POST | `/broadcasts/{id}/cancel` | `broadcasts:write` | `broadcasts.cancel` | `cancel-broadcast` | Covered |
| POST | `/broadcasts/{id}/duplicate` | `broadcasts:write` | `broadcasts.duplicate` | `duplicate-broadcast` | Covered |
| GET | `/segments/{id}/contacts` | `segments:read` | `contacts.list` | `list-contacts` | Covered |
| GET | `/contacts/{id}/segments` | `contacts:read` | `contacts.segments.list` | `list-contact-segments` | Covered |
| GET | `/contacts/{id}/topics` | `contacts:read` | `contacts.topics.list` | `list-contact-topics` | Covered |
| PATCH | `/contacts/{id}/topics` | `contacts:write` | `contacts.topics.update` | `update-contact-topics` | Covered |
| POST | `/contacts/{id}/segments/{segment}` | `contacts:write` | `contacts.segments.add` | `add-contact-to-segment` | Covered |
| DELETE | `/contacts/{id}/segments/{segment}` | `contacts:write` | `contacts.segments.remove` | `remove-contact-from-segment` | Covered |
| GET | `/emails/receiving` | `emails:read` | `emails.receiving.list` | `list-received-emails` | Covered |
| GET | `/emails/receiving/{id}` | `emails:read` | `emails.receiving.get` | `get-received-email` | Covered |
| GET | `/emails/receiving/{id}/attachments` | `emails:read` | `emails.receiving.attachments.list` | `list-received-email-attachments` | Covered |
| GET | `/emails/receiving/{id}/attachments/{attachmentId}` | `emails:read` | `emails.receiving.attachments.get` | `get-received-email-attachment` | Covered |
| POST | `/events/send` | `events:write` | `events.send` | `send-event` | Covered |
| GET | `/logs` | `logs:read` | `logs.list` | `list-logs` | Covered |
| GET | `/logs/{id}` | `logs:read` | `logs.get` | `get-log` | Covered |
| POST | `/smtp/auth` | `emails:write` | — | — | SMTP gateway authentication bridge; uses the gateway protocol rather than a user SDK or MCP operation. |
| POST | `/smtp/emails` | `emails:write` | — | — | SMTP gateway delivery bridge; use emails.send or send-email for user integrations. |
| GET | `/oauth/grants` | `full_access` | `oauthGrants.list` | `list-oauth-grants` | Covered |
| DELETE | `/oauth/grants/{id}` | `full_access` | `oauthGrants.revoke` | `revoke-oauth-grant` | Covered |
| POST | `/webhooks` | `webhooks:write` | `webhooks.create` | `create-webhook` | Covered |
| GET | `/webhooks` | `webhooks:read` | `webhooks.list` | `list-webhooks` | Covered |
| GET | `/webhooks/{webhook_id}` | `webhooks:read` | `webhooks.get` | `get-webhook` | Covered |
| PATCH | `/webhooks/{webhook_id}` | `webhooks:write` | `webhooks.update` | `update-webhook` | Covered |
| DELETE | `/webhooks/{webhook_id}` | `webhooks:write` | `webhooks.remove` | `remove-webhook` | Covered |
| POST | `/webhooks/{webhook_id}/signing-secret/rotate` | `webhooks:write` | `webhooks.rotateSigningSecret` | `rotate-webhook-signing-secret` | Covered |
| GET | `/webhooks/{webhook_id}/events` | `webhooks:read` | `webhooks.events.list` | `list-webhook-events` | Covered |
| GET | `/webhooks/{webhook_id}/events/{event_id}` | `webhooks:read` | `webhooks.events.get` | `get-webhook-event` | Covered |
| POST | `/webhooks/{webhook_id}/events/{event_id}/replay` | `webhooks:write` | `webhooks.events.replay` | `replay-webhook-event` | Covered |
| GET | `/webhooks/{webhook_id}/events/{event_id}/attempts` | `webhooks:read` | `webhooks.events.attempts.list` | `list-webhook-event-attempts` | Covered |
| POST | `/suppressions` | `contacts:write` | `suppressions.add` | `add-suppression` | Covered |
| GET | `/suppressions` | `contacts:read` | `suppressions.list` | `list-suppressions` | Covered |
| POST | `/suppressions/batch/add` | `contacts:write` | `suppressions.batch.add` | `batch-add-suppressions` | Covered |
| POST | `/suppressions/batch/remove` | `contacts:write` | `suppressions.batch.remove` | `batch-remove-suppressions` | Covered |
| GET | `/suppressions/{suppression}` | `contacts:read` | `suppressions.get` | `get-suppression` | Covered |
| DELETE | `/suppressions/{suppression}` | `contacts:write` | `suppressions.remove` | `remove-suppression` | Covered |
| GET | `/emails/metrics` | `emails:read` | `emails.metrics` | `get-email-metrics` | Covered |
| POST | `/contacts/imports` | `contacts:write` | `contacts.imports.create` | `create-contact-import` | Covered |
| GET | `/contacts/imports` | `contacts:read` | `contacts.imports.list` | `list-contact-imports` | Covered |
| GET | `/contacts/imports/{id}` | `contacts:read` | `contacts.imports.get` | `get-contact-import` | Covered |
| POST | `/automations` | `automations:write` | `automations.create` | `create-automation` | Covered |
| GET | `/automations` | `automations:read` | `automations.list` | `get-automation` | Covered |
| GET | `/automations/{automation_id}` | `automations:read` | `automations.get` | `get-automation` | Covered |
| PATCH | `/automations/{automation_id}` | `automations:write` | `automations.update` | `update-automation` | Covered |
| DELETE | `/automations/{automation_id}` | `automations:write` | `automations.remove` | `remove-automation` | Covered |
| POST | `/automations/{automation_id}/duplicate` | `automations:write` | `automations.duplicate` | `duplicate-automation` | Covered |
| POST | `/automations/{automation_id}/stop` | `automations:write` | `automations.stop` | `stop-automation` | Covered |
| GET | `/automations/{automation_id}/runs` | `automations:read` | `automations.runs.list` | `get-automation-runs` | Covered |
| GET | `/automations/{automation_id}/runs/{run_id}` | `automations:read` | `automations.runs.get` | `get-automation-runs` | Covered |
| POST | `/audiences` | `segments:write` | — | — | Deprecated segments alias; SDK audiences uses segments and MCP uses create-segment. |
| GET | `/audiences` | `segments:read` | — | — | Deprecated segments alias; SDK audiences uses segments and MCP uses list-segments. |
| GET | `/audiences/{id}` | `segments:read` | — | — | Deprecated segments alias; SDK audiences uses segments and MCP uses get-segment. |
| DELETE | `/audiences/{id}` | `segments:write` | — | — | Deprecated segments alias; SDK audiences uses segments and MCP uses remove-segment. |
| GET | `/emails/{id}/attachments` | `emails:read` | `emails.attachments.list` | `list-sent-email-attachments` | Covered |
| GET | `/emails/{id}/attachments/{attachmentId}` | `emails:read` | `emails.attachments.get` | `get-sent-email-attachment` | Covered |
| GET | `/broadcasts/{id}/recipients` | `broadcasts:read` | `broadcasts.recipients` | `list-broadcast-recipients` | Covered |
| GET | `/broadcasts/{id}/clicked-links` | `broadcasts:read` | `broadcasts.clickedLinks` | `list-broadcast-clicked-links` | Covered |
| POST | `/domains/claim` | `domains:write` | `domains.claims.create` | `create-domain-claim` | Covered |
| GET | `/domains/{id}/claim` | `domains:read` | `domains.claims.get` | `get-domain-claim` | Covered |
| POST | `/domains/{id}/claim/verify` | `domains:write` | `domains.claims.verify` | `verify-domain-claim` | Covered |
| GET | `/usage` | `full_access` | `usage.get` | `get-usage` | Covered |
| POST | `/whatsapp/messages` | `whatsapp:write` | `whatsapp.messages.send`, `whatsapp.messages.create` | `send-whatsapp-message` | Covered |
| GET | `/whatsapp/messages` | `whatsapp:read` | `whatsapp.messages.list` | `list-whatsapp-messages` | Covered |
| GET | `/whatsapp/messages/{id}` | `whatsapp:read` | `whatsapp.messages.get` | `get-whatsapp-message` | Covered |
| POST | `/media/uploads` | `media:write` | `media.create` | `create-media-upload` | Covered |
| POST | `/media/uploads/{id}/complete` | `media:write` | `media.complete` | `complete-media-upload` | Covered |
| POST | `/whatsapp/media` | `whatsapp:write` | `whatsapp.media.upload` | `upload-whatsapp-media` | Covered |
| GET | `/whatsapp/phone-numbers` | `whatsapp:read` | `whatsapp.phoneNumbers.list` | `list-whatsapp-phone-numbers` | Covered |
| GET | `/whatsapp/phone-numbers/{id}` | `whatsapp:read` | `whatsapp.phoneNumbers.get` | `get-whatsapp-phone-number` | Covered |
| GET | `/whatsapp/conversations` | `whatsapp:read` | `whatsapp.conversations.list` | `list-whatsapp-conversations` | Covered |
| GET | `/whatsapp/conversations/{id}/messages` | `whatsapp:read` | `whatsapp.conversations.messages`, `whatsapp.conversations.listMessages` | `list-whatsapp-conversation-messages` | Covered |
| POST | `/messenger/messages` | `messenger:write` | `messenger.messages.send`, `messenger.messages.create` | `send-messenger-message` | Covered |
| GET | `/messenger/messages` | `messenger:read` | `messenger.messages.list` | `list-messenger-messages` | Covered |
| GET | `/messenger/messages/{id}` | `messenger:read` | `messenger.messages.get` | `get-messenger-message` | Covered |
| GET | `/messenger/pages` | `messenger:read` | `messenger.pages.list` | `list-messenger-pages` | Covered |
| GET | `/messenger/pages/{id}` | `messenger:read` | `messenger.pages.get` | `get-messenger-page` | Covered |
| GET | `/messenger/conversations` | `messenger:read` | `messenger.conversations.list` | `list-messenger-conversations` | Covered |
| GET | `/messenger/conversations/{id}/messages` | `messenger:read` | `messenger.conversations.messages`, `messenger.conversations.listMessages` | `list-messenger-conversation-messages` | Covered |
| POST | `/instagram/messages` | `instagram:write` | `instagram.messages.send`, `instagram.messages.create` | `send-instagram-message` | Covered |
| GET | `/instagram/messages` | `instagram:read` | `instagram.messages.list` | `list-instagram-messages` | Covered |
| GET | `/instagram/messages/{id}` | `instagram:read` | `instagram.messages.get` | `get-instagram-message` | Covered |
| GET | `/instagram/accounts` | `instagram:read` | `instagram.accounts.list` | `list-instagram-accounts` | Covered |
| GET | `/instagram/accounts/{id}` | `instagram:read` | `instagram.accounts.get` | `get-instagram-account` | Covered |
| GET | `/instagram/conversations` | `instagram:read` | `instagram.conversations.list` | `list-instagram-conversations` | Covered |
| GET | `/instagram/conversations/{id}/messages` | `instagram:read` | `instagram.conversations.messages`, `instagram.conversations.listMessages` | `list-instagram-conversation-messages` | Covered |
| POST | `/whatsapp/messages/{id}/read` | `whatsapp:write` | `whatsapp.messages.markRead` | `mark-message-read`, `mark_message_read` | Covered |
| POST | `/whatsapp/conversations/{id}/typing` | `whatsapp:write` | `whatsapp.conversations.typing` | `set-typing`, `set_typing` | Covered |
| POST | `/messenger/messages/{id}/read` | `messenger:write` | `messenger.messages.markRead` | `mark-message-read`, `mark_message_read` | Covered |
| POST | `/messenger/conversations/{id}/typing` | `messenger:write` | `messenger.conversations.typing` | `set-typing`, `set_typing` | Covered |
| POST | `/instagram/messages/{id}/read` | `instagram:write` | `instagram.messages.markRead` | `mark-message-read`, `mark_message_read` | Covered |
| POST | `/instagram/conversations/{id}/typing` | `instagram:write` | `instagram.conversations.typing` | `set-typing`, `set_typing` | Covered |
| GET | `/contacts/{id}/call-permission` | `calling:read` | `whatsapp.callPermissions.getForContact` | `get-contact-call-permission` | Covered |
| POST | `/contacts/{id}/call-permission` | `calling:write` | `whatsapp.callPermissions.requestForContact` | `request-contact-call-permission` | Covered |
| GET | `/whatsapp/calls` | `calling:read` | `whatsapp.calls.list` | `list-whatsapp-calls` | Covered |
| POST | `/whatsapp/calls` | `calling:write` | `whatsapp.calls.place`, `whatsapp.calls.connect` | `connect-whatsapp-call`, `place-whatsapp-call` | Covered |
| GET | `/whatsapp/calls/{id}` | `calling:read` | `whatsapp.calls.get` | `get-whatsapp-call` | Covered |
| POST | `/whatsapp/calls/{id}/pre_accept` | `calling:write` | `whatsapp.calls.preAccept` | `pre-accept-whatsapp-call` | Covered |
| POST | `/whatsapp/calls/{id}/accept` | `calling:write` | `whatsapp.calls.accept` | `accept-whatsapp-call` | Covered |
| POST | `/whatsapp/calls/{id}/reject` | `calling:write` | `whatsapp.calls.reject` | `reject-whatsapp-call` | Covered |
| POST | `/whatsapp/calls/{id}/terminate` | `calling:write` | `whatsapp.calls.terminate` | `terminate-whatsapp-call` | Covered |
| GET | `/whatsapp/phone-numbers/{id}/calling` | `calling:read` | `whatsapp.phoneNumbers.getCalling` | `get-whatsapp-calling` | Covered |
| POST | `/whatsapp/phone-numbers/{id}/calling` | `calling:write` | `whatsapp.phoneNumbers.updateCalling` | `update-whatsapp-calling` | Covered |
| PATCH | `/whatsapp/phone-numbers/{id}/calling` | `calling:write` | `whatsapp.phoneNumbers.patchCalling` | `patch-whatsapp-calling` | Covered |
| GET | `/whatsapp/call-permissions` | `calling:read` | `whatsapp.callPermissions.get` | `get-whatsapp-call-permissions` | Covered |
| POST | `/whatsapp/call-permissions` | `calling:write` | `whatsapp.callPermissions.request` | `request-whatsapp-call-permission` | Covered |
| POST | `/ivrs` | `ivrs:write` | `ivrs.create` | `create-ivr` | Covered |
| GET | `/ivrs` | `ivrs:read` | `ivrs.list` | `list-ivrs` | Covered |
| GET | `/ivrs/{id}` | `ivrs:read` | `ivrs.get` | `get-ivr` | Covered |
| PATCH | `/ivrs/{id}` | `ivrs:write` | `ivrs.update` | `update-ivr` | Covered |
| DELETE | `/ivrs/{id}` | `ivrs:write` | `ivrs.remove` | `remove-ivr` | Covered |
| POST | `/ivrs/{id}/validate` | `ivrs:read` | `ivrs.validate` | `validate-ivr` | Covered |
| POST | `/ivrs/{id}/render` | `ivrs:write` | `ivrs.render` | `render-ivr` | Covered |
| POST | `/ivrs/{id}/rotate-signing-secret` | `ivrs:write` | `ivrs.rotateSigningSecret` | `rotate-ivr-signing-secret` | Covered |
| POST | `/voice-bots` | `voice_bots:write` | `voiceBots.create` | `create-voice-bot` | Covered |
| GET | `/voice-bots` | `voice_bots:read` | `voiceBots.list` | `list-voice-bots` | Covered |
| GET | `/voice-bots/{id}` | `voice_bots:read` | `voiceBots.get` | `get-voice-bot` | Covered |
| PATCH | `/voice-bots/{id}` | `voice_bots:write` | `voiceBots.update` | `update-voice-bot` | Covered |
| DELETE | `/voice-bots/{id}` | `voice_bots:write` | `voiceBots.remove` | `remove-voice-bot` | Covered |
| POST | `/voice-providers` | `voice_providers:write` | `voiceProviders.create` | `create-voice-provider` | Covered |
| GET | `/voice-providers` | `voice_providers:read` | `voiceProviders.list` | `list-voice-providers` | Covered |
| DELETE | `/voice-providers/{id}` | `voice_providers:write` | `voiceProviders.remove` | `remove-voice-provider` | Covered |
| GET | `/voice-providers/elevenlabs/voices` | `voice_providers:read` | `voiceProviders.listVoices` | `list-elevenlabs-voices` | Covered |
| GET | `/whatsapp/calls/{id}/transcript` | `calling:read` | `whatsapp.calls.transcript` | `get-whatsapp-call-transcript` | Covered |
| GET | `/events/catalog` | `events:read` | `events.catalog` | `list-event-catalog` | Covered |

## Limits and lead verification

The legacy OpenAPI YAML is outside this task's allowed edit paths. The enrichment module and its tests provide complete examples and descriptions within `convex/api/openapi*`; consumers that publish the YAML directly need to use the enriched contract or apply the equivalent documentation updates in an authorized lane. The enrichment also corrects 17 knowledge/bot-tool 413 response references that incorrectly point at Error400 in the base YAML; it reuses the existing Error413 schema and leaves route behavior unchanged. No route behavior defects were found in this audit. Direct OAuth protocol endpoints, public file download capabilities, provider callbacks, tracking, unsubscribe and gateway callbacks are outside the bearer-key REST surface; the existing backend contract test explicitly audits those protocol exclusions.

The lead should exercise connected-account details and conversation pagination for WhatsApp, Messenger and Instagram; upload one small media file; stop an automation and confirm existing runs continue; create/list/remove an unused voice provider; and try a Custom key with channel-only scopes against unified messages. Verify webhook delivery/replay, calling PATCH versus POST settings, and IVR/knowledge/tool workflows in the serialized e2e environment. This lane does not run browser e2e or the calling harness.

To export the enriched OpenAPI document without editing the base YAML:

```sh
pnpm exec tsx -e 'import SwaggerParser from "@apidevtools/swagger-parser"; import { buildOpenApi, type OpenApiDocument } from "./convex/api/openapi"; SwaggerParser.parse("openapi/opensend.yaml").then(source => process.stdout.write(JSON.stringify(buildOpenApi(source as unknown as OpenApiDocument), null, 2)))' > /tmp/opensend-v2.openapi.json
```

## Verification

Checks were run sequentially in this worktree; Vitest used two workers.

| Check | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed; no errors, one existing dependency warning in `components/dashboard/calling/softphone-provider.tsx` (outside this lane) |
| `pnpm test` | 653 passed |
| `pnpm test:auth --maxWorkers=2` | 1,248 passed |
| `pnpm test:sdk` | 673 passed; four live integration tests skipped by configuration |
| `pnpm test:mcp` | 660 passed; one live integration test skipped by configuration |
| `pnpm build` | Passed, with Node heap capped at 3 GiB |
| SDK and MCP package typechecks | Passed, including MCP test types |
| OpenAPI JSON export command above | Passed; emitted `/tmp/opensend-v2.openapi.json` |

No browser e2e, calling harness, deploy, push or marketing-repository changes were performed.
