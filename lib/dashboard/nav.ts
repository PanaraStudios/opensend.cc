import {
  ChartColumnIcon,
  FileCodeIcon,
  GlobeIcon,
  KeyRoundIcon,
  MailsIcon,
  MegaphoneIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  WebhookIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  href: string
  title: string
  icon: LucideIcon
  match?: readonly string[]
}

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/emails", title: "Emails", icon: MailsIcon },
  { href: "/broadcasts", title: "Broadcasts", icon: MegaphoneIcon },
  { href: "/automations", title: "Automations", icon: WorkflowIcon },
  { href: "/templates", title: "Templates", icon: FileCodeIcon },
  {
    href: "/contacts",
    title: "Audience",
    icon: UsersIcon,
    match: ["/contacts", "/properties", "/segments", "/topics"],
  },
  { href: "/metrics", title: "Metrics", icon: ChartColumnIcon },
  { href: "/domains", title: "Domains", icon: GlobeIcon },
  { href: "/logs", title: "Logs", icon: ScrollTextIcon },
  { href: "/api-keys", title: "API keys", icon: KeyRoundIcon },
  { href: "/webhooks", title: "Webhooks", icon: WebhookIcon },
  { href: "/settings", title: "Settings", icon: SettingsIcon },
]

export type SectionTab = { href: string; title: string }
export type SectionTabs = readonly [SectionTab, ...SectionTab[]]

export const EMAIL_TABS: SectionTabs = [
  { href: "/emails", title: "Sending" },
  { href: "/emails/receiving", title: "Receiving" },
  { href: "/emails/suppressions", title: "Suppressions" },
]

export const AUDIENCE_TABS: SectionTabs = [
  { href: "/contacts", title: "Contacts" },
  { href: "/properties", title: "Properties" },
  { href: "/segments", title: "Segments" },
  { href: "/topics", title: "Topics" },
]

export const SETTINGS_NAV: SectionTabs = [
  { href: "/settings", title: "General" },
  { href: "/settings/team", title: "Team" },
  { href: "/settings/exports", title: "Exports" },
  { href: "/settings/billing", title: "Billing" },
  { href: "/settings/sso", title: "SSO" },
  { href: "/settings/unsubscribe", title: "Unsubscribe" },
  { href: "/settings/ses", title: "Amazon SES" },
  { href: "/settings/smtp", title: "SMTP" },
]

/** A section is active on its index route and on every route beneath it. */
export function pathMatches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function navItemActive(pathname: string, item: NavItem): boolean {
  const hrefs = item.match ?? [item.href]
  return hrefs.some((href) => pathMatches(pathname, href))
}

/** Tabs are exact: the settings index tab must not light up on /settings/team. */
export function tabActive(pathname: string, href: string): boolean {
  return pathname === href
}

const TEAM_SAFE_PATHS = new Set<string>([
  ...DASHBOARD_NAV.flatMap((item) => item.match ?? [item.href]),
  ...EMAIL_TABS.map((item) => item.href),
  ...AUDIENCE_TABS.map((item) => item.href),
  ...SETTINGS_NAV.map((item) => item.href),
])

/** Keep list/settings routes when switching teams; drop record detail ids. */
export function teamSafePath(pathname: string): string {
  if (TEAM_SAFE_PATHS.has(pathname)) return pathname
  const parent = pathname.replace(/\/[^/]+$/, "")
  if (TEAM_SAFE_PATHS.has(parent)) return parent
  return "/emails"
}
