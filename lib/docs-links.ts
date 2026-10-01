import { pathMatches } from "./dashboard/nav"
import { DOCS_URL } from "./site"

export type DocsPath = "/docs" | `/docs/${string}`

/** Paths are checked against the public site's pages by docs-links.test.ts. */
export const DOCS_LINKS = {
  routes: {
    "/api-keys": "/docs/create-an-api-key",
    "/automations": "/docs/dashboard/automations/introduction",
    "/automations/events": "/docs/dashboard/automations/trigger",
    "/broadcasts": "/docs/dashboard/broadcasts",
    "/channels": "/docs/self-hosting/requirements",
    "/contacts": "/docs/dashboard/audience/contacts",
    "/domains": "/docs/dashboard/domains/manage",
    "/emails": "/docs/dashboard/emails/sending",
    "/emails/calls": "/docs/self-hosting/requirements",
    "/emails/inbox": "/docs/dashboard/receiving/introduction",
    "/emails/receiving": "/docs/dashboard/receiving/introduction",
    "/emails/suppressions": "/docs/dashboard/emails/suppressions",
    "/instance/meta": "/docs/self-hosting/requirements",
    "/instance/ses": "/docs/self-hosting/aws-ses",
    "/logs": "/docs/dashboard/logs",
    "/metrics": "/docs/dashboard/emails/metrics",
    "/profile": "/docs/self-hosting/security",
    "/properties": "/docs/dashboard/audience/properties",
    "/segments": "/docs/dashboard/audience/segments",
    "/settings": "/docs/dashboard/team/roles",
    "/settings/exports": "/docs/dashboard/exports",
    "/settings/ses": "/docs/self-hosting/aws-ses",
    "/settings/smtp": "/docs/self-hosting/smtp-gateway",
    "/settings/sso": "/docs/dashboard/team/sso",
    "/settings/team": "/docs/dashboard/team/roles",
    "/settings/unsubscribe": "/docs/dashboard/audience/unsubscribe-page",
    "/settings/usage": "/docs/self-hosting/ses-tenancy",
    "/templates": "/docs/dashboard/templates/editor",
    "/topics": "/docs/dashboard/audience/topics",
    "/webhooks": "/docs/webhooks/introduction",
  },
  topics: {
    introduction: "/docs",
    dnsRecords: "/docs/add-a-domain",
    dmarc: "/docs/dashboard/domains/dmarc",
    receiving: "/docs/dashboard/receiving/introduction",
    tracking: "/docs/dashboard/domains/tracking",
    tls: "/docs/dashboard/domains/tls",
    regions: "/docs/dashboard/domains/regions",
    idempotency: "/docs/dashboard/emails/idempotency",
    smtp: "/docs/self-hosting/smtp-gateway",
    webhookVerification: "/docs/webhooks/verify",
    awsSes: "/docs/self-hosting/aws-ses",
    setup: "/docs/self-host-in-10-minutes",
    apiKeys: "/docs/create-an-api-key",
    oauthApps: "/docs/dashboard/oauth-apps",
  },
} as const satisfies {
  routes: Record<`/${string}`, DocsPath>
  topics: Record<string, DocsPath>
}

export function docsHref(path: DocsPath): string {
  return `${DOCS_URL}${path.slice("/docs".length)}`
}

// More specific tabs win over their section, including on nested detail pages.
const routes = Object.entries(DOCS_LINKS.routes).sort(
  ([a], [b]) => b.length - a.length
)

export function docsHrefForRoute(pathname: string): string {
  const path = routes.find(([route]) => pathMatches(pathname, route))?.[1]
  return docsHref(path ?? DOCS_LINKS.topics.introduction)
}

export function docsHrefForDnsRecord(record: string): string {
  const topics = DOCS_LINKS.topics
  return docsHref(
    record === "DMARC"
      ? topics.dmarc
      : record === "MX"
        ? topics.receiving
        : topics.dnsRecords
  )
}
