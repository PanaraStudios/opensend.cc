export type NavIcon =
  | "mails"
  | "megaphone"
  | "users"
  | "layers"
  | "tag"
  | "globe"
  | "key"
  | "scroll"
  | "webhook"

export type NavItem = {
  href: string
  title: string
  icon: NavIcon
}

export type NavGroup = {
  label: string | null
  items: NavItem[]
}

export const DASHBOARD_NAV: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/emails", title: "Emails", icon: "mails" },
      { href: "/broadcasts", title: "Broadcasts", icon: "megaphone" },
    ],
  },
  {
    label: "Audience",
    items: [
      { href: "/contacts", title: "Contacts", icon: "users" },
      { href: "/segments", title: "Segments", icon: "layers" },
      { href: "/topics", title: "Topics", icon: "tag" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/domains", title: "Domains", icon: "globe" },
      { href: "/api-keys", title: "API Keys", icon: "key" },
      { href: "/logs", title: "Logs", icon: "scroll" },
      { href: "/webhooks", title: "Webhooks", icon: "webhook" },
    ],
  },
]

export const SETTINGS_NAV = [
  { href: "/settings", title: "General" },
  { href: "/settings/team", title: "Team" },
  { href: "/settings/ses", title: "Amazon SES" },
  { href: "/settings/smtp", title: "SMTP" },
] as const

export function pathMatches(pathname: string, href: string): boolean {
  if (href === "/settings") {
    return pathname === "/settings"
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
