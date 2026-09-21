# Onboarding and domains verification

Branch: `feat/ses-onboarding`.
Base commit: `08cf36a05b01dcd32c402fe514fd4c321db2f01e` plus the implementation
working tree. No changes have been merged or published.

## Completed implementation checkpoint (2026-09-21)

Before committing the completed SES integration, lint, typechecking, 209 unit
tests and 79 backend tests passed again. The preceding execution reported a
passing production build and 18 Chromium tests; those browser/build checks will
be refreshed after the separate installation-navigation change. The checkpoint
includes the dedicated SES connection editor, DNS-provider detection, disabled
unsupported controls, TLS verification preservation, and live Created timestamps.
Private environment files, AWS templates, backups and browser artifacts are
excluded. The existing `.env.example` documentation edit remains outside the commit.
The existing review installation remains running at http://localhost:3500.

## Restored domain UI

The original domain detail structure from the base commit is restored: header,
Created/Status/Provider/Region strip, compact alert, domain event trail, Records
and Configuration tabs, the existing DNS sections and action menus. The added
AWS status cards, tenant panel, bottom history card and Return to setup link were
removed. Existing-identity approval uses a dialog and appears only for identity
review/ownership conflicts. Original list pagination controls now load indexed
Convex pages instead of using a replacement Load more button. Unsupported DNS
automation/receiving/tracking controls remain disabled instead of simulating work.

Saving the first domain atomically marks setup complete once the installation,
regional resources and team's default SES tenant are ready. The existing shared
domain form redirects to `/domains/{id}` with the full dashboard available. DNS
verification, sandbox approval and domain-specific errors do not keep the wizard
open. Existing pending installations finish when opening their domain page. Send
readiness and resource authorization remain separate backend checks.

Read-only AWS inspection found the original `opensend.cc` identity associated with
a Cocomail tenant; no association was removed by the agent. The user chose
`app.opensend.cc` and reported removing the original association themselves.
That subdomain's failed PutEmailIdentityConfigurationSetAttributes call was
redundant: a live GetEmailIdentity response confirmed creation already applied
the intended configuration set. Provisioning now skips that redundant write.
The IAM template also grants this action on the installation's configuration sets
as well as its identities, as required when an assignment does change. AWS-issued
DNS records are retained even if a later configuration operation fails.

Lint, typechecking, 75 backend tests and 209 unit tests passed. Regressions cover
atomic setup completion/rollback, incomplete DNS still blocking sends, preserving
DNS records on provider failure, and avoiding redundant configuration updates.
An initial browser run verified full navigation but failed an overly exact Search
locator (its accessible name includes the keyboard shortcut); that locator was
corrected. A pagination callback type error was caught and fixed before the final
build. A later concurrent browser run hit a one-second Better Auth adapter timeout;
the full Chromium suite was rerun alone and passed all 18 tests. The onboarding,
original domain controls and completed-setup navigation passed in Firefox (1/1)
and WebKit (1/1). CSV download contents were verified in the final Chromium and
Firefox runs. All disposable projects were cleaned up.

- [Final Chromium report](../../test-results/opensend-e2e-1789959667344-a0690b/html/index.html)
- [Firefox report](../../test-results/opensend-e2e-1789959470481-e71ca1/html/index.html)
- [WebKit report](../../test-results/opensend-e2e-1789959164756-4d7b76/html/index.html)
- [Restored desktop domain page](../../test-results/opensend-e2e-1789959667344-a0690b/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-dns.png)
- [Restored mobile domain page](../../test-results/opensend-e2e-1789959667344-a0690b/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-mobile.png)

Final review app image:
`sha256:7683a3fe2532fa488ff1170c350b3913fe9c1673f4090f2cb6951bd24c52749b`.
The current manual-review account, team and AWS connection were preserved. Reload
the existing domain page to finish its legacy pending setup state and display the
full dashboard. Use the existing DNS refresh control to retry `app.opensend.cc`.
No live AWS write/retry was performed by the agent for this revision; the user's
manual provider retry and DNS changes remain the acceptance check. The corrected
IAM template is in `test-results/manual-aws/` with the `-domain-fix.json` suffix.

## SES tenant creation order correction

On the third local setup (`opensend-ses-review-1789956238530`, installation
`jd745xx2jjqkn52sxmxtcfkgss8evbfe`), regional SNS/SQS provisioning succeeded.
The user's next screenshot showed GetTenant denied. A read-only live lookup
confirmed AWS was evaluating the nonexistent tenant against `Resource: *`, not
its future tenant ARN. This was a provisioning-order bug in Opensend.

Unacknowledged tenants now start with CreateTenant and verify ownership afterward,
including on AlreadyExists recovery. The generated IAM policy separates tenant
creation into a region/request-tag constrained grant; existing tenant operations
retain their ARN restriction. The review backend was deployed without retrying
the user's AWS operation. Their existing stack needs the corrected template and
then Retry tenant setup; no reset is needed.

Lint, typechecking, 71 backend tests, 208 unit tests, and four-region `cfn-lint`
validation passed. Regressions cover denied missing-tenant reads, lost creation
acknowledgment, and foreign-tenant collisions. Live creation with the revised
policy remains for the user's manual retry.

The production app image built successfully and was applied only to the current
review app. The Docker-backed Chromium onboarding/template-download journey passed
(1/1): [browser report](../../test-results/opensend-e2e-1789957281848-e2cebe/html/index.html).
Review image: `sha256:ed0ff3dc4f674f39db2cedfac4a37e1184d22a83ec248acc6f02ca268e0d2f3b`.

## Live SNS authorization diagnosis

The fresh installation's regional setup failed with `AuthorizationErrorException`.
A read-only `GetTopicAttributes` call using its stored AWS connection confirmed
that no identity policy allowed `sns:GetTopicAttributes` for its new installation
topic. A read-only STS check confirmed the key belongs to `user/opensend` in the
configured account. No AWS resources or IAM policies were modified by these checks.
The applied AWS policy still needs correction through the existing CloudFormation
stack; the exact attached policy has not been read.

`awsError` now recognizes SNS's authorization error name and retains the operation
name for other provider errors without exposing raw provider messages. Lint,
typechecking and all 69 backend tests passed. A fresh CloudFormation template for
installation `jd7dg54sw9hawptkw719mjtsy58et5e0` is available in the ignored
`test-results/manual-aws/` directory for the user's stack update. Live provisioning
remains awaiting that update and the user's retry.

## Fresh-instance login correction

The manual review instance was reset at the user's request into a new Compose
project, `opensend-ses-review-1789954504636`, keeping the previous volume and
`.env.ses-review-backup-1789954504636` for recovery. The new database was checked
empty before signup. The review URL remains http://localhost:3500.

The reset initially advertised `http://localhost:3511` as the backend HTTP origin.
Signup and verified password authentication succeeded, but the backend could not
fetch its JWKS through a host-only remapped port, causing protected routes to
redirect back to login. The setup script now normalizes loopback HTTP origins to
`host.docker.internal`. The live instance was corrected without deleting its new
account. An in-container request to the configured signing-key endpoint returned
HTTP 200. Lint passed.

The browser harness now starts with a remapped localhost HTTP origin to exercise
this regression. Its callback probe reads setup's normalized configuration. The
initial run passed signup/login but failed that probe because the harness still
used the original address; the final rerun uses the corrected configuration and
passed the full signup, verification, login and onboarding journey (1/1).
[Fresh-instance regression report](../../test-results/opensend-e2e-1789955170746-ecaf8e/html/index.html).

## Domain layout and permission-error revision

Domain list and detail routes now use the existing dashboard shell during the
domain setup step. The sidebar only exposes Domains and Setup; the team switcher,
profile menu, invitations and global search remain unavailable. Other setup steps
keep the auth layout. Direct Profile URLs and team mutation denials remain covered.

The domain screen now surfaces tenant failures before the generic workflow error,
explains why DNS records are missing, hides the identity-adoption prompt while the
tenant is unavailable, and offers a resolved IAM policy download. This reuses the
current setup policy, including tenant permissions; no AWS policies or credentials
were changed automatically. The user's live `GetTenant` denial is still awaiting
inspection/retesting of the policy attached in AWS. The current generated template
contains `ses:GetTenant`; this alone does not prove that the active user has it.

Verification: `pnpm lint`, `pnpm typecheck`, production Docker build, and all 207
`pnpm test` cases passed. The full Chromium suite passed 18/18. Final mobile
refinements (metadata truncation and wrapping DNS controls) passed the Firefox and
WebKit onboarding journeys, 1/1 each; the Firefox mobile screenshot was visually reviewed.

- [Chromium report](../../test-results/opensend-e2e-1789953664541-0cc22b/html/index.html)
- [Firefox report](../../test-results/opensend-e2e-1789953934438-c3479e/html/index.html)
- [WebKit report](../../test-results/opensend-e2e-1789954038759-8e7d8d/html/index.html)
- [Desktop domain screenshot](../../test-results/opensend-e2e-1789953664541-0cc22b/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-dns.png)
- [Final mobile domain screenshot](../../test-results/opensend-e2e-1789953934438-c3479e/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-mobile.png)

Review image: `sha256:e2d66f6116a593225851d416968ab2df4d163cf0f79ba7acdd4b2e688d5db1a8`.
Only the review app container was replaced; the backend and stored setup were preserved.
Two parallel Firefox/WebKit attempts stopped before browser execution because the
local OIDC provider did not start within the harness deadline; both sequential
reruns passed. All disposable test projects and volumes were cleaned up.

Manual review: reload http://localhost:3500 and open the existing domain. Check
the full-width page, Domains back link, setup-only sidebar and permission download.
Review the existing Opensend IAM user's managed policy, then retry the operation.
Live AWS/DNS verification remains manual; browser DNS results use controlled fixtures.

## AWS tenant and setup-access revision

The next revision adds native AWS SES tenant provisioning per team and region,
tenant-level suppression, ownership-checked identity/configuration-set associations,
ordered cleanup and a mandatory tenant-aware send binding for the upcoming send
pipeline. Cocomail was inspected read-only; [the focused reference review](../ses-tenancy.md)
records which patterns were useful and which were not reused.

The AWS connection screen now provides a preconfigured IAM user/policy template,
a link to AWS CloudFormation, and local AWS-key CSV import. Fully prefilled launch
links need a parameterized template hosted in S3; no such external publication was
performed. The generated local upload template includes the tenant permissions.

At this earlier revision, unfinished setup could not expose Profile, Settings or
the sidebar, including on the domain page. The layout revision above now allows a
restricted sidebar for domain routes. Team administration and invitations remain blocked by
backend checks. Only the first team can be created at the wizard's team step.

Verification completed for this revision:

- Lint, typechecking and production Docker build passed.
- 206 dashboard/template/CSV tests and 68 backend/auth tests passed.
- The generated four-region CloudFormation template passed `cfn-lint` validation.
- The full Chromium suite passed all 18 tests, including template download,
  CSV import, direct-URL setup bypass attempts and direct API denials.
- The same onboarding journey passed in Firefox and WebKit.
- Fixed a DNS table column collapsing inside the narrow setup layout; it now
  keeps a readable minimum width and scrolls horizontally.

[Chromium report](../../test-results/opensend-e2e-1789948791918-f7c7bb/html/index.html),
[Firefox report](../../test-results/opensend-e2e-1789948954203-235057/html/index.html),
[WebKit report](../../test-results/opensend-e2e-1789949103804-a26302/html/index.html),
[AWS setup helper screenshot](../../test-results/opensend-e2e-1789948791918-f7c7bb/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/aws-setup-helper.png).

AWS calls in automated provider tests use controlled responses. Actual IAM policy
application, SES tenant creation, AWS reputation enforcement and DNS/SNS delivery
still need the user's live acceptance tests. Sending itself remains a later
milestone; the current work prepares and validates its tenant resource binding.

## Wizard revision after manual feedback

The wizard now uses the shared auth layout and shows one of six steps at a time:
welcome, AWS connection, delivery updates, resources, team, and domain. Back and
Continue save the current step in Convex. Setup generates a random per-installation
encryption key and stores it encrypted; users do not configure an SES environment
variable. The server's existing authentication secret protects the stored key.
Legacy credentials remain readable with their original key.

The delivery-updates screen detects a public Convex URL when available. Local
installations get a plain explanation and their actual HTTP port. The review
instance needs a public HTTPS URL forwarding to `http://localhost:3511`.

Verification for this revision:

- Lint and typechecking passed; the production Docker image built successfully.
- 57 backend/auth tests passed, including automatic key creation with no SES
  encryption environment variable, key preservation, secret exclusion, and saved
  step authorization.
- The full Chromium suite passed all 18 tests. The complete revised onboarding
  journey also passed in Firefox and WebKit.
- Fixed a browser-test timing race by waiting for the post-login screen before
  navigating to account deletion.
- Updated the running review instance without resetting its account or data.

[Chromium report](../../test-results/opensend-e2e-1789944593362-b1d635/html/index.html),
[Firefox report](../../test-results/opensend-e2e-1789944470045-acd3a4/html/index.html),
[WebKit report](../../test-results/opensend-e2e-1789944546692-e70a5a/html/index.html).

[Updated desktop screen](../../test-results/opensend-e2e-1789944593362-b1d635/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/onboarding-desktop.png),
[updated mobile screen](../../test-results/opensend-e2e-1789944593362-b1d635/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/onboarding-mobile.png),
[delivery updates screen](../../test-results/opensend-e2e-1789944593362-b1d635/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/onboarding-delivery-updates.png).

The historical results and manifest below describe the original milestone before
this revision. Live AWS/DNS/SNS checks remain reserved for manual acceptance.

## Environment and scope

macOS ARM64, Docker Desktop, production Next.js 16.2.6 app image, Convex 1.45.0,
Workflow 0.4.8 (including Workpool and batch worker), Better Auth 1.6.15,
AWS SES SDK 3.1131.0 and STS/SNS/SQS SDK 3.1136.0. Tests use the pinned Convex
backend/dashboard images loaded from the existing local image archives; direct
GHCR pulls returned `denied`. The Node and Keycloak images use the existing pinned
digests from the Dockerfile and Compose file.

All automated accounts, databases, ports, logs and reports are isolated from the
fresh manual review instance. Browser scenarios use real authentication, Convex
queries/mutations, workflows, and the production app. AWS-success fixture rows
are installed only through an ownership-checked test helper; fixture credentials
cannot contact AWS. Unit/integration provider tests intercept SDK calls. Neither
kind of fixture is evidence of live AWS success.

Live AWS, DNS and public HTTPS/SNS verification are reserved for the user's
manual wizard tests, as requested. Sending, recipient feedback normalization,
customer webhooks, the HTTP API, SDK and component are later milestones.

## Original milestone results (before the wizard revision)

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, host production build, Docker production build | Passed |
| Dashboard unit tests | 200 passed |
| Convex/auth/provider-boundary tests | 55 passed |
| Preserved setup-helper regressions | 5 passed |
| Chromium full suite | 18 passed; 0 failed/skipped |
| Firefox critical suite | 7 passed; 0 failed/skipped |
| WebKit critical suite | 7 passed; 0 failed/skipped |
| Disposable snapshot restore | Passed; all eight selected application/auth tables matched exactly |
| Live AWS / public DNS / SNS HTTPS delivery | Not run; user will verify through the wizard |

Working-tree manifest SHA-256 (excludes this report):
`f22936c8d7571ebe461bc6c029c71b68786231fa0035adb7b28268b9aa89052d`.
The reviewed Docker image is
`sha256:1c7c8793cd6a67c361f117cd4c90778f31ee87634f71a197fd83f03dca4085a5`;
backend functions were deployed separately from the final working tree.

Local evidence (ignored by Git):

- [Working-tree file manifest](../../test-results/ses-verification/working-tree.json)
- [Chromium HTML report](../../test-results/opensend-e2e-1789940564470-cdd75a/html/index.html)
- [Firefox HTML report](../../test-results/opensend-e2e-1789940166290-af0bc3/html/index.html)
- [WebKit HTML report](../../test-results/opensend-e2e-1789940491707-f06b4d/html/index.html)
- [Desktop onboarding](../../test-results/opensend-e2e-1789940564470-cdd75a/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/onboarding-desktop.png)
- [Mobile onboarding](../../test-results/opensend-e2e-1789940564470-cdd75a/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/onboarding-mobile.png)
- [Domain DNS screen](../../test-results/opensend-e2e-1789940564470-cdd75a/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-dns.png)
- [Dark domain screen](../../test-results/opensend-e2e-1789940564470-cdd75a/browser/auth-Docker-self-hosted-au-a6600-ifies-the-bootstrap-account/domain-dark.png)
- [Restore result](../../test-results/opensend-e2e-restore-1789940007279/result.json)
- [Verification command logs](../../test-results/ses-verification/)
- [Repaired Firefox failure trace](../../test-results/opensend-e2e-1789939850766-942603/browser/input-validation-inputs-sh-a5f53-hout-form-specific-wrappers/trace.zip)

Only the separate `opensend-ses-review` app, backend and dashboard remain running.
Automated test and restore containers/volumes were removed after ownership checks.

## Commands

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:auth
pnpm build
python3 -m unittest discover -s docs/legacy-ses -p 'test_*.py'

# Production image and isolated browser suite
# E2E_CONVEX_IMAGE / E2E_DASHBOARD_IMAGE can select locally cached pinned images.
docker compose --env-file .env.ses-review -p opensend-ses-review build app
OPENSEND_SKIP_BUILD=1 node scripts/test-e2e.mjs
OPENSEND_SKIP_BUILD=1 OPENSEND_BROWSER=firefox node scripts/test-e2e.mjs \
  --grep 'protects dashboard|input|login hierarchy'
OPENSEND_SKIP_BUILD=1 OPENSEND_BROWSER=webkit node scripts/test-e2e.mjs \
  --grep 'protects dashboard|input|login hierarchy'

# Retain a completed test instance to run the restore drill; never use review/prod.
OPENSEND_KEEP_E2E=1 OPENSEND_SKIP_BUILD=1 node scripts/test-e2e.mjs
node scripts/test-ses-restore.mjs .env.playwright-opensend-e2e-RUN_ID
```

`pnpm test` needs local IPC for tsx. The production build needs network access to
Google Fonts, as the existing font configuration requires.

## Coverage matrix

| Capability | Evidence |
| --- | --- |
| Bootstrap signup, verification through logs, returning login, invitations, MFA, SSO, OAuth | Docker Chromium authentication regression suite |
| Environment check, correct backend challenge, reload/resume | Browser onboarding flow, real Node action and HTTP action |
| Account validation, credential encryption, wrong account, failed/successful rotation | `convex/ses.test.ts`, intercepted STS/SES boundary and real database mutations |
| Installation admin versus team admin/member, revoked sessions and cross-team operations | Convex tests plus browser/direct-API permission assertions |
| Region provisioning, partial failure, retry, ownership tags and policy preservation | SDK-boundary integration tests; real AWS pending manual test |
| Domain creation, normalized validation, duplicate submissions and region restrictions | Convex mutations, Workflow registration and browser domain form |
| Domain listing, prefix/status/region filters and pagination | Indexed query integration tests and browser list rendering |
| Domain details, returned DNS values, sending settings and persistence | Browser actions, reload, second authenticated context; DNS resolver tests |
| Domain removal, retained restrictions, failed claims and adoption restoration | SDK-boundary integration tests and dashboard restriction regression |
| Existing-identity adoption with review and stale-review fingerprint | SDK-boundary integration tests; live IAM/DNS pending manual test |
| SNS signatures, forged payloads, certificate URL restrictions, size limit and deduplication | Real RSA fixtures migrated from the retired package and integration tests |
| Signed subscription confirmation and early callback state preservation | SDK-boundary integration test |
| Backend/app restarts | Docker OAuth and SSO regression scenarios |
| Snapshot restoration | Disposable restore drill: exact equality for installation, domains, history, regions, bootstrap, users, memberships and teams |
| Desktop/mobile and light/dark modes, focus and form validation | Chromium plus critical Firefox/WebKit runs and screenshots |

## Repaired failures

- Node actions could not call a backend advertised at a published `localhost`
  port from inside Docker. Local setup now derives a host-reachable backend
  origin; the real wizard action proves the callback path works.
- Workflow tests required the newer `convex-test` implementation of function
  metadata. Updated to 0.0.58; nested Workflow/Workpool components are registered.
- Typechecking Workflow test sources required an ES2020 target for BigInt.
- Firefox did not dismiss a validation popover with Escape. Added focused-control
  key handling and retained the browser regression.
- Removing a domain previously broadened demo API-key restrictions to all domains.
  Restrictions now remain attached to the removed ID; re-addition uses a new ID.
- Failed claims on unrelated SES identities can now be removed locally without
  deleting the unrelated AWS identity.
- Team deletion and last-member departure now require removing domains first;
  the connected installation administrator cannot delete their account.

## Manual handoff (updated wizard)

Review: http://localhost:3500
Fresh install: http://localhost:3500/signup
Convex dashboard: http://localhost:6793
Environment file: `.env.ses-review` (private; do not share).

Read verification links with:

```sh
OPENSEND_ENV_FILE=.env.ses-review pnpm backend logs
```

1. Sign in and click **Get started**. Opensend creates its encryption key without
   requiring an SES environment variable.
2. Connect AWS using the account ID and access key. Extra regions and an existing
   server role are available under **More options**.
3. On **Receive delivery updates**, check the detected HTTPS URL or enter a tunnel
   URL forwarding to the review backend at `http://localhost:3511`.
4. Review and provision the regional resources. Check tags, scoped policies,
   subscription redrive, sandbox state and quotas in AWS.
5. Use Back and reload between steps. Confirm the current step is retained and
   only one step appears in the auth layout.
6. Create a team and domain. Publish its DNS records and refresh verification.
7. Finish setup, then create another team without repeating installation setup.

Pending live checks: AWS provisioning, IAM permissions on the actual account,
DNS propagation, SNS HTTPS delivery and credential rotation against AWS. Screens
and operations requiring those prerequisites remain part of manual acceptance.
Do not treat this milestone as production sending readiness: sending is the third
feature in the agreed sequence.
