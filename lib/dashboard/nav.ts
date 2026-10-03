import {
  ChartColumnIcon,
  CloudIcon,
  FileCodeIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  MailsIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  RadioTowerIcon,
  ScrollTextIcon,
  SettingsIcon,
  UsersIcon,
  WebhookIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react"

import { CHANNELS, CHANNEL_IDS } from "../channels"

/** Where Settings opens. */
export const SETTINGS_NAV_INDEX = "/settings/team"

export type NavItem = {
  href: string
  title: string
  icon: LucideIcon
  match?: readonly string[]
  /** What else finds the page in the command menu. */
  keywords?: string[]
}

/** Email domains are a channel: the old Domains list opens Channels on
    email, and /domains/[id] stays the domain's page. */
export const EMAIL_CHANNELS_HREF = "/channels?type=email"

/** Installation-wide pages only the installation admin opens, from the
    account menu and ⌘K. Amazon SES comes first. */
export const INSTANCE_PAGES = [
  { href: "/instance/ses", title: "Amazon SES", icon: CloudIcon },
  { href: "/instance/meta", title: "Meta app", icon: MessagesSquareIcon },
] as const satisfies readonly NavItem[]

export const isInstancePage = (pathname: string) =>
  INSTANCE_PAGES.some((page) => page.href === pathname)

export const DASHBOARD_NAV: NavItem[] = [
  { href: "/emails", title: "Messages", icon: MailsIcon },
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
  {
    href: "/channels",
    title: "Channels",
    icon: RadioTowerIcon,
    match: ["/channels", "/domains"],
    keywords: ["Domains", ...CHANNEL_IDS.map((id) => CHANNELS[id].label)],
  },
  { href: "/logs", title: "Logs", icon: ScrollTextIcon },
  { href: "/api-keys", title: "API keys", icon: KeyRoundIcon },
  { href: "/webhooks", title: "Webhooks", icon: WebhookIcon },
  { href: "/playground", title: "Playground", icon: FlaskConicalIcon },
  {
    href: SETTINGS_NAV_INDEX,
    title: "Settings",
    icon: SettingsIcon,
    match: ["/settings"],
  },
]

export type SectionTab = { href: string; title: string }
export type SectionTabs = readonly [SectionTab, ...SectionTab[]]

/** Delivery logs across every channel; manual testing lives in Playground. */
export const EMAIL_TABS: SectionTabs = [
  { href: "/emails", title: "Sending" },
  { href: "/emails/receiving", title: "Receiving" },
  { href: "/emails/suppressions", title: "Suppressions" },
]

export const PLAYGROUND_TABS: SectionTabs = [
  { href: "/playground/inbox", title: "Inbox" },
  { href: "/playground/calls", title: "Calls" },
  { href: "/playground/ivr", title: "IVR" },
  { href: "/playground/voice-bot", title: "Voice bot" },
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
  { href: "/settings/usage", title: "Usage" },
  { href: "/settings/ai-providers", title: "AI providers" },
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
  ...INSTANCE_PAGES.map((item) => item.href),
  ...DASHBOARD_NAV.flatMap((item) => item.match ?? [item.href]),
  ...EMAIL_TABS.map((item) => item.href),
  ...PLAYGROUND_TABS.map((item) => item.href),
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
