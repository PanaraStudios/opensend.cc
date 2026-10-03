# Dashboard documentation links

`lib/docs-links.ts` owns dashboard route and named topic destinations. The
longest matching route wins, with a slash boundary, so receiving details do
not open the sending guide. Unknown routes fall back to the docs index.
`DocsButton` and the sidebar use the same resolver; a button can override its
destination with `href`. All these links open a new tab with `rel="noreferrer"`.
DNS links select the verification, receiving, or DMARC guide by record type.

Screens without a page-level Docs button retain their existing layout and use
the sidebar link. The API-key permission tooltip contains text only; AWS setup
links open operational AWS consoles. There were no other Learn more, InfoTip,
or onboarding documentation links to repoint in this base.

## Routes

All destinations below are relative to `https://opensend.cc/docs`. Nested
detail/editor routes inherit the most specific matching entry.

| Dashboard route                  | Docs path                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `/api-keys`                      | `/create-an-api-key`                                                                        |
| `/automations`                   | `/dashboard/automations/introduction`                                                       |
| `/automations/events`            | `/dashboard/automations/trigger`                                                            |
| `/broadcasts`                    | `/dashboard/broadcasts`                                                                     |
| `/channels`                      | `/self-hosting/requirements` (until a channels guide exists)                                |
| `/contacts`                      | `/dashboard/audience/contacts`                                                              |
| `/domains`                       | `/dashboard/domains/manage` (a domain's page; the list redirects to `/channels?type=email`) |
| `/emails`                        | `/dashboard/emails/sending`                                                                 |
| `/emails/receiving`              | `/dashboard/receiving/introduction`                                                         |
| `/emails/suppressions`           | `/dashboard/emails/suppressions`                                                            |
| `/instance/meta`                 | `/self-hosting/requirements` (until a Meta page exists)                                     |
| `/instance/ses`, `/settings/ses` | `/self-hosting/aws-ses`                                                                     |
| `/logs`                          | `/dashboard/logs`                                                                           |
| `/metrics`                       | `/dashboard/emails/metrics`                                                                 |
| `/profile`                       | `/self-hosting/security`                                                                    |
| `/properties`                    | `/dashboard/audience/properties`                                                            |
| `/segments`                      | `/dashboard/audience/segments`                                                              |
| `/settings`, `/settings/team`    | `/dashboard/team/roles`                                                                     |
| `/settings/exports`              | `/dashboard/exports`                                                                        |
| `/settings/smtp`                 | `/self-hosting/smtp-gateway`                                                                |
| `/settings/sso`                  | `/dashboard/team/sso`                                                                       |
| `/settings/unsubscribe`          | `/dashboard/audience/unsubscribe-page`                                                      |
| `/settings/usage`                | `/self-hosting/ses-tenancy`                                                                 |
| `/templates`                     | `/dashboard/templates/editor`                                                               |
| `/topics`                        | `/dashboard/audience/topics`                                                                |
| `/webhooks`                      | `/webhooks/introduction`                                                                    |

The site has no dedicated usage or profile guide as of 2026-09-29. Usage links
to SES tenancy, which explains shared account quotas and team isolation;
profile links to security. OAuth apps has a named topic link for use where a
context-specific link is needed; its UI is inside Profile and Team, not a
separate route. Other named topics cover DNS, DMARC, receiving, tracking, TLS,
regions, idempotency, SMTP, webhook verification, AWS SES, setup, and API keys.

## Checking and refreshing destinations

`pnpm test` includes `lib/docs-links.test.ts`. If the local public-site source
exists, it reads the MDX file list there at test time. Otherwise it validates
against `lib/docs-pages.json`; the snapshot is also checked independently.
Neither build imports or depends on the website repository.

Refresh the snapshot from the application repository root after the public
site adds, moves, or removes pages:

```sh
python3 - <<'PY'
import json
from pathlib import Path

root = Path('/Users/kamalpanara/Desktop/projectk/kamalkit/opensendcc/content/docs')
assert root.is_dir(), root
pages = sorted(
    '/docs' if path.relative_to(root).as_posix() == 'index.mdx'
    else '/docs/' + path.relative_to(root).with_suffix('').as_posix()
    for path in root.rglob('*.mdx')
)
Path('lib/docs-pages.json').write_text(json.dumps(pages, indent=2) + '\n')
PY
pnpm test
```

## Removed help sheets and content handoff

Removed `DocsSheet`, `DocsCode`, `DocsSection`, and the nine feature wrappers:
`ApiKeysDocsSheet`, `AudienceDocsSheet`, `AutomationsDocsSheet`,
`BroadcastsDocsSheet`, `DomainsDocsSheet`, `EmailsDocsSheet`, `LogsDocsSheet`,
`TemplatesDocsSheet`, and `WebhooksDocsSheet`. Their nine `*_DOCS` constants
and open/close state at 18 call sites are gone. The existing outline button,
BookOpen icon, and Docs label are preserved.

The public guides cover most removed material. The following details were
not found explicitly in the public docs inspected on 2026-09-29 and should be
reviewed by the docs owner before migration:

- Domains: choosing a subdomain to separate transactional and marketing
  reputation without affecting the root domain; the claim that automatic DNS
  checks continue for 72 hours; warning that inbound MX replaces an existing
  mailbox provider and recommending a subdomain to preserve that mailbox;
  explicitly stating that API callers never receive AWS credentials.
- API keys: the rotation sequence “create a replacement, deploy it, then delete
  the old key.” Token visibility and revocation are already documented.
- Logs: dashboard filters for date, status class, user agent, and source;
  search matching method, endpoint, and status; the exact scope of “network
  headers” redaction. Public docs already describe secret-header redaction.
- Audience: the explicit reserved contact-property keys `email`, `first_name`,
  `last_name`, and `unsubscribed`; the fact that contacts never see segment names.
- Templates: the explicit statement that `{{{NAME}}}` and
  `{{{NAME|fallback}}}` work in both subject and body. The public broadcast
  example demonstrates a body fallback, and variable definitions are documented,
  but the template guide does not spell out this editor syntax.

These removed claims/examples conflict with current public documentation and
must not be copied verbatim:

- Domains said “Receipt rules and an inbox come later”; receiving is now built.
- Logs claimed every API, SMTP, and dashboard request is logged. The public
  guide describes team-attributed API requests and SMTP bridge requests.
- Automations demonstrated `POST /events`; current docs use `POST /events/send`.
  The old editing advice only described duplication; public docs also support
  disabling before editing and snapshotting active runs.
- Broadcasts demonstrated `segmentId` and omitted the sender; the public API
  uses `segment_id` and documents its actual sender requirements.
- API keys used `https://api.opensend.cc` in the sample. Public guides correctly
  use the installation's API base URL.

No public-site files were changed. The Playwright flow only checks dashboard
link attributes and never loads the external documentation site.
