# v2 unit coverage

Recorded on 2026-10-05 on `test/v2-coverage`.

This checkout has no `origin/master` ref. The module list is `git diff 2f2c5f2...HEAD` for `convex`, `lib`, and `packages`. `2f2c5f2` is the parent of the first merge named `feat/v2-simplify`.

Product code is unchanged. New tests pin the behaviour that already runs.

## Modules covered

- `lib/dashboard/format.ts` in `lib/dashboard/format.test.ts`. Relative time from one minute of clock skew through a year, then the calendar date. Labels for email, domain, broadcast, export, suppression, template, automation, and skip reasons. Permissions, roles, regions, channels, rates, addresses, and initials.
- `convex/templateChannels.ts` in `convex/templateChannels.test.ts`. Email, WhatsApp, Messenger, and Instagram field rules for REST and the dashboard. WhatsApp names, categories, component types, and parameter format. Messaging publish limits and draft merge.
- `convex/api/route.ts` field and page parsers in `convex/api/routeFields.test.ts`. Page size 1 to 100, one cursor at a time, and the string, boolean, enum, object, array, and string-list body fields.
- `convex/messageShape.ts` in `convex/messageShape.test.ts`. The unified message fields, including the ISO timestamp. Outbound mail links the first recipient in the same team. Inbound mail links the sender. An address that does not parse links nobody, and reading does not create a contact.
- `packages/sdk/src/whatsapp/schema.ts` in `packages/sdk/src/whatsapp/schema.spec.ts`. String, number, integer, boolean, enum, pattern, array, object, `oneOf`, and `anyOf` checks. Media accepts one of `id` or `link`. Locations stay inside their range. Contact lists stop at 257.
- `packages/sdk/src/common/utils/build-pagination-query.ts` in `packages/sdk/src/common/utils/build-pagination-query.spec.ts`. Empty options, limit, after, before, and the resulting URL.
- `packages/mcp/src/tools/channelMessaging.ts` helpers in `packages/mcp/tests/tools/channelHelpers.test.ts`. `channelPageCheck` refuses `after` and `before` together. `channelOutput` returns object data as structured content and throws the provider error.

## Bugs found

None. The new assertions match the current code.

The schema tests record two details that are easy to misread later.

`validateWhatsAppSchema` treats `minLength` as "not blank", including whitespace. A `minLength` above 1 does not count characters. Every catalog schema sets `minLength` to 1. `maxLength` counts Unicode code points.

An email content row whose `text` is an empty string previews as that empty string. `html` and the subject are used only when `text` is absent.

## Still untested

Left untouched because another agent is editing them. `convex/calling`, `convex/voice`, `convex/ivr`, `services/`, and `components/`. `lib/calling/browser.ts` was left with those.

These v2 modules still have thin or no direct tests of their own branches. A higher-level suite touches some of them.

- `convex/ses/reputation.ts`. The sending-status lease and its five-minute retry window.
- `convex/channels/templates.ts`. A template variable with the wrong type. The page messaging suite already expects 422 when a variable is missing.
- `convex/knowledge/resources.ts`, `convex/api/channelMessages.ts`, `convex/storage/files.ts`, and `convex/storage/objects.ts`.
- `convex/meta/connect.ts`, `convex/meta/connectActions.ts`, `convex/meta/pageConnectActions.ts`, `convex/meta/pageState.ts`, and `convex/meta/app.ts`.
- `convex/receivedParse.ts` and `convex/receivedDownloads.ts`. `convex/received.test.ts` already covers the received-mail HTTP routes.
- `convex/botToolkitAccess.ts`. Paging a detach across voice bots.
- Dashboard hooks in `lib/`, including `use-broadcasts`, `use-audience`, `use-shortcut`, and `use-media-player`.

This pass did not add another suite for behaviour that already has tests. That includes idempotency in `convex/api/state.ts`, retention jobs, broadcast send, channel read and typing limits, WhatsApp catalog fixtures, and Messenger and Instagram template sends.
