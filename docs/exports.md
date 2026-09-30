# Dashboard CSV exports

Domains, API keys, logs, contacts and segments use `convex/exportSources.ts`.
Their toolbar opens one shared confirmation dialog, capturing both the raw
filters and the displayed summary at that moment. Settings → Exports lists
files with the shared team pager and aggregate count; the detail page shows
the stored summary and creator email.

Any team member can create or view exports. Only admins can request a download
URL. Completed exports of at most 1,000 rows automatically download for the
admin who started them while their browser session remains open. Larger exports,
and exports started by members, appear in Settings → Exports. Downloads use
`{resource}-{createdAt ms}.csv` and remain available for seven days. Reads enforce
expiry even before the cleanup cron deletes the storage object. Old expired
rows are retained for another 30 days.

CSV headers for domains, API keys and logs follow the observed Resend exports.
Contact fields match [List Contacts](https://resend.com/docs/api-reference/contacts/list-contacts),
with custom property keys appended. Segment `id`, `created_at` and `name` match
[List Segments](https://resend.com/docs/api-reference/segments/list-segments);
`contacts` is our count column required by the task (the API does not document a
CSV count header). Counts come from the segment membership aggregate. Times use
UTC Postgres text with six fractional digits. API tokens remain masked and CSV
formula cells are escaped. Unsupported domain content-storage and tracking flags
are false. Files exceeding the existing 200,000-row job limit fail instead of
silently returning a truncated CSV.

## Integration

After deployment, run the existing `migrations:backfillCounts` runner to populate
the new `exportCounts` aggregate for historical exports. New writes use the
counted write helpers immediately. Older rows have fallback filenames and empty
creator/filter metadata; those details were not stored previously.

`internal.exports.emailCreator` is deliberately a no-op seam, scheduled when a
completed export exceeds 1,000 rows. The sending lane should implement it using
the installation sender, addressing `creatorEmail` and linking to the authenticated
`/settings/exports/{id}` page. Do not email a storage URL: download authorization
must remain admin-only. Current toasts promise availability in Settings, not email.

Emails, received emails, suppressions and broadcasts retain their demo export
sources until the sending/receiving lanes provide real sources. They use the
same confirmation dialog; their local rows follow real exports in the shared
pager and have disabled downloads because no CSV is generated yet. Old demo
contacts/segments and seeded exports are excluded.
