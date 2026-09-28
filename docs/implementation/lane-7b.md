# Lane 7B handoff

Base: `0b10d8d`; branch: `codex/lane-7b`.

## Delivered

- Team-scoped options queries for contacts, segments, topics, contact properties,
  templates, custom events, live domains, historical metric domains, and command
  menu emails. Every options query accepts `search` and `selectedId`, returns at
  most 20 rows, and reads the current selection independently. Custom events also
  accept `selectedName`, because automation steps store names. Foreign-team,
  missing, deleted, or ineligible selections are omitted.
- Empty searches return newest records. Contact email, event name, and domain
  searches use prefix indexes; contact name, template, and email searches use
  existing search indexes. Small, write-capped configuration sets use shared
  case-insensitive exact/prefix/substring ranking. Selected rows reserve one of
  the twenty slots.
- The installation sender's domain suggestions follow the same cap and selection
  rules, guarded by installation-admin access. They intentionally span teams.
- `SuggestInput` debounces its existing input once in the shared component and
  retains the current choice. `OptionSelect` and `PaperSelect` render the selected
  choice in the menu as well as the trigger. Shared `Command`/`CommandItem` support
  server-ranked results while keeping local filtering for static navigation.
- Tenant cleanup uses Convex cursor pagination with `usePaginatedQuery`,
  `useLoadedPagination`, and the existing `ListPagination`. No menu has a pager,
  footer, or load-more row.
- Added two domain indexes for newest-first eligibility-filtered suggestions.
  No tables or HTTP routes were added, and no screens needed migration from a
  demo store. No backend deployment, AWS operation, or e2e run was performed.

## Picker inventory

| Picker | Result |
| --- | --- |
| Command menu: contacts | Server search, 20 results, email prefixes plus indexed name matches |
| Command menu: emails | Dedicated indexed server search, 20 results; no discarded list-search cursor |
| Command menu: domains | Dedicated prefix search, 20 results |
| Automation trigger/custom-event inputs | Shared debounce, server prefix search, selected-name lookup |
| Automation condition/contact-update property inputs | Shared debounce, server property search; existing property prefix handled |
| Installation account-email sender domain | Shared debounce, indexed search, selected-domain lookup, admin access |
| Automation test-event contact | 20 suggestions and selected-ID lookup; search deferred below |
| Automation add-to-segment | 20 suggestions and selected-ID lookup; search deferred below |
| Automation send-email template | 20 suggestions and selected-ID lookup; existing template detail lookup retained; search deferred below |
| Broadcast audience segment and subscription topic | 20 suggestions and selected-ID lookup; search deferred below |
| Broadcast/template sender address | 20 domain suggestions; existing explicit sender stays visible; search deferred below |
| API-key domain restriction | 20 suggestions; existing selected-domain lookup retained; search deferred below |
| Metrics domain filter | 20 suggestions with selected-ID lookup, including removed domains; search deferred below |
| Audience add/import/filter segment selects, contact segment checklist, bulk segment/topic choices | Existing full bounded definitions retained; no search input to reuse |
| Contact topic/property forms and property import mapping | Complete definitions retained so the picker cap cannot hide form fields |
| Log user-agent filter | Existing 100-distinct-value index seeks and selected-string retention left intact; no search input to reuse |

**Required UI deferrals:** `OptionSelect` wraps Base UI Select;
`ToolbarFilters` uses `OptionSelect`; `PaperSelect` wraps a radio dropdown.
None exposes a search input. Per the lane instruction, these have not been
redesigned or given a new input. Their options endpoints are search-ready, but
older unselected rows outside the first 20 remain unreachable from these menus
until a searchable shared picker is approved. The audience checklists similarly
have no reusable search input. This is a remaining product limitation, not a
claim that all menus now support server search.

`segments.definitions`, `topics.definitions`, and `contactProperties.definitions`
preserve the existing complete definition reads for forms and the audience
controls above. Their enforced per-team creation limits are 500 segments,
100 topics, and 100 active properties. They are separate from bounded picker
suggestions so fields and existing memberships do not disappear at row 21.

Team SES status/onboarding uses `tenants.list` with a bound of five; there are
only four supported regions and at most one tenant per team/region, so this does
not truncate a growable table. The installation-wide cleanup list was the
unbounded-growth case and is now paginated.

Unchanged as instructed: the Better Auth team snapshot reads 50 memberships,
100 active-team members, and 100 invitation rows. OAuth grant lists read 100
rows (team application creation also enforces a 100-grant limit).

## Search behavior and validation

Full-text results retain Convex's relevance and token/prefix semantics, rather
than promising arbitrary substring matching across unbounded data. See the
[Convex search documentation](https://docs.convex.dev/search/text-search).
Ordinary prefix indexes avoid full-text term expansion limits for domain,
email-address, and event-name lookups.

New coverage: 15 Convex tests and 3 unit tests. Coverage includes caps,
newest-first ordering, search beyond the first twenty, selection lookup,
selection during search, deleted and foreign selections, team permission denial,
argument validation, member writes, domain eligibility, and cleanup pagination
beyond 25 records. Existing 100-result expectations were updated to 20. The SES
cleanup assertion was updated through a small Python script, as required for
existing test files that import Node builtins.

Final verification: `pnpm typecheck`, `pnpm exec tsc --noEmit -p convex`, and
`pnpm lint` passed with no warnings. `pnpm test`: 264/264 passed.
`pnpm test:auth`: 546/546 passed across 34 files. An initial export-test failure
passed both its targeted rerun and the final full suite without export changes.
