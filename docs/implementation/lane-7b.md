# Lane 7B handoff

Base: `0b10d8d`; part 2 continues `a55de9c`; branch: `codex/lane-7b`.

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
  retains the current choice. `OptionSelect`, `ToolbarFilters`, and `PaperSelect`
  now accept optional server search, sharing one `SearchableSelect` implementation
  with a 250 ms debounce and selected-label retention during query loading.
  Their existing triggers and static-list behavior are preserved. Searchable
  menus compose the existing Combobox input, content, list, items, and empty
  state, following Base UI's [input-inside-popup pattern](https://base-ui.com/react/components/combobox#input-inside-popup).
  Opening focuses search; typing on a closed trigger opens search; arrow keys,
  Enter, and Escape use the Combobox keyboard behavior.
- Shared `Command`/`CommandItem` support server-ranked results while keeping
  local filtering for static navigation. Sender search extracts the domain from
  a typed/pasted mailbox; its default sender remains independent of search.
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
| Automation test-event contact | Server search and selected-ID lookup |
| Automation add-to-segment | Server search and selected-ID lookup |
| Automation send-email template | Server search and selected-ID lookup; existing template detail lookup retained |
| Broadcast audience segment and subscription topic | Server search and selected-ID lookup |
| Broadcast/template sender address | Server domain search and selected-ID lookup via sender domain name; explicit sender stays visible |
| API-key domain restriction | Server search and selected-ID lookup; existing selected-domain detail lookup retained |
| Metrics domain filter | Server search and selected-ID lookup, including removed domains |
| Audience add/import/filter segment selects, contact segment checklist, bulk segment/topic choices | Complete bounded definitions retained as instructed; no rows hidden by the picker cap |
| Contact topic/property forms and property import mapping | Complete definitions retained so the picker cap cannot hide form fields |
| Log user-agent filter | Unchanged: 100 distinct values via index seeks with selected-string retention; no server options-search endpoint |

All select-menu search deferrals from the first handoff are resolved. Each newly
searchable picker passes its debounced search and current selection to the
existing options query. No backend functions, tables, routes, or schema changes
were needed in part 2, and no UI outside the approved searchable menus changed.

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

Part 1 coverage: 15 Convex tests and 3 unit tests. Coverage includes caps,
newest-first ordering, search beyond the first twenty, selection lookup,
selection during search, deleted and foreign selections, team permission denial,
argument validation, member writes, domain eligibility, and cleanup pagination
beyond 25 records. Existing 100-result expectations were updated to 20. The SES
cleanup assertion was updated through a small Python script, as required for
existing test files that import Node builtins.

Part 2 adds two unit tests for sender-domain search normalization (raw domains,
partial/full mailboxes, whitespace, and clearing). There is no existing component
unit-test setup, so none was introduced. A temporary local browser fixture used
the shared picker source with simulated async results, without a backend. It
verified ordinary and paper triggers, input autofocus, closed-trigger typing,
arrow navigation, Enter selection beyond the initial twenty, retained selected
labels during loading and after clearing search, the empty state, Escape with
focus restoration, and unchanged static Select menus. The fixture is outside
the repository; no `tests/e2e/` files were changed or executed.

Final part 2 verification: `pnpm typecheck`, `pnpm exec tsc --noEmit -p convex`,
and `pnpm lint` passed with zero warnings. `pnpm test`: 266/266 passed.
`pnpm test:auth`: 546/546 passed across 34 files. No live backend, AWS, or
integrated e2e verification was performed.

Commits: `a55de9c` (bounded server search), followed by the part 2 commit reported
with this handoff (search inside the capped select menus).
