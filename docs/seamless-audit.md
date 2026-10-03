# Seamless multichannel audit

Branch: `feat/v2-seamless`, based on `v2`. Audited before implementation on 2026-10-04. Read `CLAUDE.md`, the Convex AI guidelines, and the installed Next.js client-component guide. Existing public routes and fields must remain compatible; changes are additive.

| Area | Gap / evidence from side-by-side audit | Fix or skip (reason) |
| --- | --- | --- |
| Message lists | `lib/channels.ts` disables Messenger/Instagram logs; `MESSAGE_CHANNEL_ITEMS` and log hook types only admit email/WhatsApp even though the merged backend supports all channel streams. Meta log parties expose scoped ids. | **Fixed:** enable all channel logs and derive filters from the registry; use public party labels. |
| Message detail | All use `DetailHeader`, `MetaStrip`, and `EventTrail`, but Meta detail embeds a whole editable conversation instead of the selected message; email lacks Payload and a Channel field. | **Fixed:** existing shared detail primitives plus one metadata helper; render the selected normalized message with existing customer-facing template/media renderer; include email payload and consistent channel/sender/recipient fields. |
| Templates | The backend already supports Messenger/Instagram local templates, but Create omits them, `asTemplate` drops their channel/content, and the router opens the email editor. Strict send validation also blocks clearing quick-reply fields during editing. | **Fixed:** preserve channel/content and add a local-message editor using existing editor chrome, controls, status/menu and preview renderer; allow incomplete drafts while retaining strict publish/send checks. |
| Templates / test send | Email has a test dialog; WhatsApp template and broadcast editors lack a send to a chosen number. Local templates need the same action for a scoped recipient. | **Fixed:** shared Meta test dialog, choosing sender/recipient/variables and using the existing channel enqueue path. Require approved WhatsApp or published local templates. |
| Editors / responsive UX | Email's action says “Test email”; WhatsApp preview disappears below desktop; top bar actions crowd names on mobile. | **Fixed:** “Send test” vocabulary, shared responsive top bar, visible mobile template previews; preserve existing test ids. |
| Template empty states | Templates say “reuse in your emails”; delete copy also speaks only of emails. | **Fixed:** channel-neutral message copy. |
| Broadcasts | Email/WhatsApp already share naming, Create menu, badges and review chrome. Backend `broadcastChannel` and workers only support email/WhatsApp. | **Skipped:** new Messenger/Instagram broadcast scheduling/delivery is a new backend feature, requiring schema enum/worker changes outside the optional-field-only rule. Keep creation restricted to supported broadcast channels. Add test send to WhatsApp above. |
| Contacts / bulk actions | Selection and bulk delete/segment/topic actions already operate on contact ids; rows label phone and channel-only contacts via `contactIdentity`. | **Skipped:** already channel-neutral; cover phone/channel-only bulk behaviour in regression tests. |
| Contacts / CSV | `convex/exportSources.ts` exports phone but no linked channel identities, although `channelContacts` has an indexed contact relation. | **Fixed:** additive identity JSON column preserving every linked scoped identity; iterate indexed identity reads to avoid truncation and preserve tenant isolation. |
| Home / onboarding | No separate Home exists; dashboard lands on Messages. Installation wizard already supports optional email and Meta setup. “Either channel” incorrectly describes four channels as two. | **Fixed:** precise channel setup copy and message/template empty-state wording; retain domain-specific email setup steps. |
| ⌘K / shortcuts | Navigation has Channels and the legacy domain shortcut, but record search only finds emails/domains, and no channel-specific destinations appear. | **Fixed:** bounded unified message/sender search, channel destinations in ⌘K, channel search keywords; document channel navigation through the existing Channels shortcut. |
| Documentation links | Shared screens have links, but Meta details fall through to email-only guides. The checked-in public-site snapshot contains no dedicated Meta guides. | **Fixed:** explicit Meta message detail mapping to the existing channel setup guide. **Skipped:** authoring new public website guides belongs in the private website repository. |
| Webhooks / picker | Picker uses catalog names but manually hardcodes prefixes, omits suppression events, and shows raw event codes as labels. | **Fixed:** catalog-driven groups/labels (including email suppression events), readable names with machine names available for developers. |
| Webhooks / samples | Catalog has schema examples for channel events but webhook pages expose no sample payload browser. | **Fixed:** derive full samples from catalog schemas; shared event picker and Payload section on webhook detail. |
| SDK / naming | Email provides send/create; shared channel client only provides send. All use the same transport `{data,error}` and shared after/before builder. Unified `/messages` deliberately has a separate opaque cursor. | **Fixed:** additive channel `create` alias and cross-channel success/error/pagination contract tests. **Skipped:** replacing established pagination or snake/camel public fields would break compatibility. |
| MCP | Unified tools exist; channel descriptions vary in sender/pagination terminology and unified list says “List readable channels” rather than messages. | **Fixed:** describe messages, sender selection, queued ids, cursor usage and unified alternatives consistently; test descriptions. |
| OpenAPI | WhatsApp is declared; Messenger/Instagram operations use undeclared tags and email has several resource tags without channel grouping. | **Fixed:** declare all channel tags and additive `x-tagGroups` grouping for shared, email, WhatsApp, Messenger, Instagram and workspace operations. |
| REST errors | `convex/api/route.ts` already maps plain Convex validation to `validation_error`; shared caller helpers produce `not_found` and `restricted_api_key`; channel and email routes use these helpers. | **Skipped:** codes already aligned; add cross-channel regression coverage instead of renaming existing errors. |
| Suppressions | Email-only by product decision. | **Skipped:** retain email-only suppression behaviour. Its webhook events still belong in the email group. |
| Automations / IVR / playground | Active rework on another branch. | **Skipped:** do not edit `components/dashboard/automations/`, `components/dashboard/playground/`, or `components/dashboard/flows/`; no e2e or calling harness execution. |

## Implementation results

15 of the 20 audit areas were fixed; 5 were skipped because they were already aligned, explicitly excluded, or require a new delivery feature. Two fixed areas retain documented compatibility/repository limitations: established SDK pagination stays supported, and new public Meta guides belong in the private website repository.

The shared channel registry now drives all message filters and template creation, while broadcast creation remains limited to email and WhatsApp. Message details reuse the existing header, metadata, event trail, customer-facing renderer, and Payload primitives. Messenger/Instagram logs show public party labels rather than scoped ids. Meta template/broadcast test sends use the production queue path and published content; WhatsApp requires Meta approval and a compatible registered sender. Local template drafts allow cleared quick-reply fields, with strict validation at publish/send and channel-specific text limits in the editor.

Contact exports retain existing columns and add `channel_identities` JSON, including scoped identities, phones, names and usernames. Indexed iteration avoids silently truncating linked identities; tenant and merged-identity checks are covered. Bulk actions already work for phone-only and channel-only contacts and now have regression coverage.

All changes preserve existing REST routes/fields, SDK responses and pagination. No schema, package script, private website, suppression behaviour, or excluded editor directory was changed. The affected e2e selectors were updated and are included in TypeScript validation; e2e and the calling harness were not run. No push or `convex dev` was performed.

## Checks

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm test` | Passed: 631 tests |
| `pnpm test:auth --maxWorkers=2` | Passed: 1,217 tests across 79 files |
| `pnpm test:sdk` | Passed: 556 tests, 4 credential-dependent live tests skipped |
| `pnpm test:mcp` | Passed: 536 tests, 1 credential-dependent live test skipped |
| `pnpm build` | Passed |

SDK and MCP package typechecks also passed. All Vitest runs used at most two workers. An earlier backend run alongside the production build hit the existing 30-second timeout for the large excluded-audience broadcast test; the final isolated full run passed, including that test (14 seconds), without changing test timeouts or scripts.

## Browser verification

Repeat the following in light and dark themes, including a 390px viewport. Live delivery requires connected senders and suitable test recipients; the automated tests use provider fixtures.

1. **Messages:** filter Sending and Receiving by each of email, WhatsApp, Messenger and Instagram. Open text, template and media details, including an older message in a long conversation. Check Channel/Sender/Recipient, readable party names, selected-message preview, event trail, downloads and Payload. Follow Open in Inbox.
2. **Templates:** use Create for all four channels. Rename, edit, duplicate, publish, inspect status and preview. For Messenger/Instagram, clear a quick-reply field, confirm the draft saves, then complete it before publishing; check variable examples and Instagram's 1,000-character limit. For an approved WhatsApp template, Send test to a chosen international number, select a compatible sender, fill published variables and upload required header media. For local templates, use an existing scoped recipient with an open conversation window. Confirm the queued message appears in Sending and displays the published content.
3. **Broadcasts:** create email and WhatsApp broadcasts, check shared naming/status/actions, and Send test for a WhatsApp template broadcast before scheduling. Messenger/Instagram broadcast creation stays unavailable because delivery is not implemented.
4. **Contacts:** select phone-only and channel-only contacts, add them to a segment and export CSV. Check phone and `channel_identities`, including sender scope and profile information.
5. **Navigation/setup:** open ⌘K and search channel destinations, messages, senders and contacts. Verify g h, g d, g 1, g 2, g 3 and the shortcuts dialog. Open Meta detail Docs and inspect the channel-neutral onboarding/template empty-state copy on an unconfigured installation.
6. **Webhooks:** create/edit subscriptions and inspect channel groups, readable labels and email suppression events. On detail, select a WhatsApp, Messenger or Instagram Sample event and inspect its nested Payload.
