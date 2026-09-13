export type NavIcon =
  | "mails"
  | "megaphone"
  | "file"
  | "workflow"
  | "users"
  | "chart"
  | "globe"
  | "scroll"
  | "key"
  | "webhook"

export type NavItem = {
  href: string
  title: string
  icon: NavIcon
  match?: readonly string[]
}

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/emails", title: "Emails", icon: "mails" },
  { href: "/broadcasts", title: "Broadcasts", icon: "megaphone" },
  { href: "/templates", title: "Templates", icon: "file" },
  { href: "/automations", title: "Automations", icon: "workflow" },
  {
    href: "/contacts",
    title: "Audience",
    icon: "users",
    match: ["/contacts", "/properties", "/segments", "/topics"],
  },
  { href: "/metrics", title: "Metrics", icon: "chart" },
  { href: "/domains", title: "Domains", icon: "globe" },
  { href: "/logs", title: "Logs", icon: "scroll" },
  { href: "/api-keys", title: "API Keys", icon: "key" },
  { href: "/webhooks", title: "Webhooks", icon: "webhook" },
]

export const EMAIL_TABS = [
  { href: "/emails", title: "Sending" },
  { href: "/emails/receiving", title: "Receiving" },
  { href: "/emails/suppressions", title: "Suppressions" },
] as const

export const AUDIENCE_TABS = [
  { href: "/contacts", title: "Contacts" },
  { href: "/properties", title: "Properties" },
  { href: "/segments", title: "Segments" },
  { href: "/topics", title: "Topics" },
] as const

export const SETTINGS_NAV = [
  { href: "/settings", title: "General" },
  { href: "/settings/team", title: "Team" },
  { href: "/settings/exports", title: "Exports" },
  { href: "/settings/billing", title: "Billing" },
  { href: "/settings/sso", title: "Single Sign-On" },
  { href: "/settings/unsubscribe", title: "Unsubscribe page" },
  { href: "/settings/ses", title: "Amazon SES" },
  { href: "/settings/smtp", title: "SMTP" },
] as const

export function pathMatches(pathname: string, href: string): boolean {
  if (href === "/settings") {
    return pathname === "/settings"
  }
  if (href === "/emails") {
    return pathname === "/emails" || pathname.startsWith("/emails/")
  }
  if (href === "/contacts") {
    return pathname === "/contacts" || pathname.startsWith("/contacts/")
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function navItemActive(pathname: string, item: NavItem): boolean {
  if (item.match) {
    return item.match.some((href) => pathMatches(pathname, href))
  }
  return pathMatches(pathname, item.href)
}

export function tabActive(pathname: string, href: string): boolean {
  return pathname === href
}
