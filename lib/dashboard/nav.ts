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

/** Where Settings opens. */
export const SETTINGS_NAV_INDEX = "/settings/team"
export const SES_SETTINGS_PAGE = { href: "/instance/ses", title: "Amazon SES" }

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
  {
    href: SETTINGS_NAV_INDEX,
    title: "Settings",
    icon: SettingsIcon,
    match: ["/settings"],
  },
]

export type SectionTab = { href: string; title: string }
export type SectionTabs = readonly [SectionTab, ...SectionTab[]]

export const EMAIL_TABS: SectionTabs = [
  { href: "/emails", title: "Sending" },
  { href: "/emails/receiving", title: "Receiving" },
  { href: "/emails/suppressions", title: "Suppressions" },
]

export const AUTOMATION_TABS: SectionTabs = [
  { href: "/automations", title: "Automations" },
  { href: "/automations/events", title: "Events" },
]

export const AUDIENCE_TABS: SectionTabs = [
  { href: "/contacts", title: "Contacts" },
  { href: "/properties", title: "Properties" },
  { href: "/segments", title: "Segments" },
  { href: "/topics", title: "Topics" },
]

export const SETTINGS_NAV: SectionTabs = [
  { href: SETTINGS_NAV_INDEX, title: "Team" },
  { href: "/settings/sso", title: "SSO" },
  { href: "/settings/unsubscribe", title: "Unsubscribe" },
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

/** Tabs are exact: an index tab must not light up on the routes beneath it. */
export function tabActive(pathname: string, href: string): boolean {
  return pathname === href
}

/** Pages of the dashboard that are no section's tab. */
export const STANDALONE_PAGES: readonly SectionTab[] = [
  { href: "/settings/exports", title: "Exports" },
  { href: "/profile", title: "Profile" },
]

const TEAM_SAFE_PATHS = new Set<string>([
  SES_SETTINGS_PAGE.href,
  ...DASHBOARD_NAV.flatMap((item) => item.match ?? [item.href]),
  ...EMAIL_TABS.map((item) => item.href),
  ...AUDIENCE_TABS.map((item) => item.href),
  ...AUTOMATION_TABS.map((item) => item.href),
  ...SETTINGS_NAV.map((item) => item.href),
  ...STANDALONE_PAGES.map((item) => item.href),
])

/** Keep list/settings routes when switching teams; drop record detail ids. */
export function teamSafePath(pathname: string): string {
  if (TEAM_SAFE_PATHS.has(pathname)) return pathname
  const parent = pathname.replace(/\/[^/]+$/, "")
  if (TEAM_SAFE_PATHS.has(parent)) return parent
  return "/emails"
}
