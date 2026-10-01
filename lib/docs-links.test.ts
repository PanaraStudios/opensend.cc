import assert from "node:assert/strict"
import { existsSync, readdirSync } from "node:fs"
import test from "node:test"
import {
  DOCS_LINKS,
  docsHref,
  docsHrefForDnsRecord,
  docsHrefForRoute,
} from "./docs-links"
import pagesSnapshot from "./docs-pages.json"
import {
  AUDIENCE_TABS,
  AUTOMATION_TABS,
  DASHBOARD_NAV,
  EMAIL_TABS,
  INSTANCE_PAGES,
  SETTINGS_NAV,
  STANDALONE_PAGES,
} from "./dashboard/nav"

const docsDirectory =
  "/Users/kamalpanara/Desktop/projectk/kamalkit/opensendcc/content/docs"
const mappedPaths = [
  ...Object.values(DOCS_LINKS.routes),
  ...Object.values(DOCS_LINKS.topics),
]

test("every mapped docs path exists in the site, or the portable snapshot", () => {
  const pages = existsSync(docsDirectory)
    ? readdirSync(docsDirectory, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".mdx"))
        .map((file) =>
          file === "index.mdx" ? "/docs" : `/docs/${file.slice(0, -4)}`
        )
    : pagesSnapshot
  for (const path of mappedPaths) assert.ok(pages.includes(path), path)
})

test("the checked-in snapshot supports every link without the private site", () => {
  for (const path of mappedPaths) assert.ok(pagesSnapshot.includes(path), path)
  assert.deepEqual(pagesSnapshot, [...new Set(pagesSnapshot)].sort())
})

test("every dashboard navigation destination has an explicit docs mapping", () => {
  for (const { href } of [
    ...DASHBOARD_NAV,
    ...EMAIL_TABS,
    ...AUDIENCE_TABS,
    ...AUTOMATION_TABS,
    ...SETTINGS_NAV,
    ...STANDALONE_PAGES,
    ...INSTANCE_PAGES,
  ]) {
    assert.ok(Object.hasOwn(DOCS_LINKS.routes, href), href)
  }
})

test("tabs and nested detail pages resolve to the most specific guide", () => {
  for (const [route, path] of [
    ["/emails/message-id", "/dashboard/emails/sending"],
    ["/emails/messages/message-id", "/dashboard/emails/sending"],
    ["/emails/inbox", "/dashboard/receiving/introduction"],
    ["/emails/receiving/message-id", "/dashboard/receiving/introduction"],
    ["/emails/suppressions", "/dashboard/emails/suppressions"],
    ["/api-keys/key-id", "/create-an-api-key"],
    ["/domains/domain-id", "/dashboard/domains/manage"],
    ["/webhooks/hook-id/delivery-id", "/webhooks/introduction"],
    ["/logs/log-id", "/dashboard/logs"],
    ["/segments/segment-id", "/dashboard/audience/segments"],
    ["/templates/template-id", "/dashboard/templates/editor"],
    ["/broadcasts/broadcast-id/edit", "/dashboard/broadcasts"],
    ["/automations/events", "/dashboard/automations/trigger"],
    ["/automations/automation-id", "/dashboard/automations/introduction"],
    ["/settings/exports/export-id", "/dashboard/exports"],
    ["/settings/sso/", "/dashboard/team/sso"],
    ["/settings/unsubscribe", "/dashboard/audience/unsubscribe-page"],
    ["/settings/smtp", "/self-hosting/smtp-gateway"],
    ["/instance/ses", "/self-hosting/aws-ses"],
    ["/instance/meta", "/self-hosting/requirements"],
    ["/channels/account-id", "/self-hosting/requirements"],
  ]) {
    assert.equal(
      docsHrefForRoute(route),
      `https://opensend.cc/docs${path}`,
      route
    )
  }
})

test("route matching respects path boundaries and falls back to the docs index", () => {
  for (const route of ["/", "/unknown", "/emails-other", "/api-keys-other"])
    assert.equal(docsHrefForRoute(route), "https://opensend.cc/docs")
  assert.equal(
    docsHrefForRoute("/emails/receiving-other"),
    "https://opensend.cc/docs/dashboard/emails/sending"
  )
})

test("DNS links distinguish verification, inbound MX, and DMARC", () => {
  for (const record of ["DKIM", "SPF"])
    assert.equal(
      docsHrefForDnsRecord(record),
      "https://opensend.cc/docs/add-a-domain"
    )
  assert.equal(
    docsHrefForDnsRecord("MX"),
    "https://opensend.cc/docs/dashboard/receiving/introduction"
  )
  assert.equal(
    docsHrefForDnsRecord("DMARC"),
    "https://opensend.cc/docs/dashboard/domains/dmarc"
  )
  assert.equal(
    docsHref(DOCS_LINKS.topics.webhookVerification),
    "https://opensend.cc/docs/webhooks/verify"
  )
})
