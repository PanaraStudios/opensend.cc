import {
  AppWindowIcon,
  CodeIcon,
  MailIcon,
  type LucideIcon,
} from "lucide-react"

import type { Platform } from "@/content/landing"
import { cn } from "@/lib/utils"

/* API, SMTP, dashboard, always in that order so tags read the same in every
   cell. */
export const PLATFORMS: { id: Platform; label: string; icon: LucideIcon }[] =
  [
    { id: "api", label: "API", icon: CodeIcon },
    { id: "smtp", label: "SMTP", icon: MailIcon },
    { id: "dashboard", label: "Dashboard", icon: AppWindowIcon },
  ]

export function formatPlatforms(platforms: Platform[]) {
  const names = PLATFORMS.filter((p) => platforms.includes(p.id)).map(
    (p) => p.label
  )
  if (names.length <= 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/* The platforms a feature ships on, one small tag each: the icon-tile look
   at chip scale, mono label. Only the platforms it's on are shown, so the
   footer of a cell is the answer, not a puzzle. Decorative: the cell speaks
   the list aloud in a sr-only line. */
export function PlatformTags({
  platforms,
  className,
}: {
  platforms: Platform[]
  className?: string
}) {
  return (
    <ul
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      aria-hidden="true"
    >
      {PLATFORMS.filter((p) => platforms.includes(p.id)).map((p) => (
        <li
          key={p.id}
          className="inline-flex h-6 items-center gap-1.5 rounded-md border border-border bg-surface/50 pr-2 pl-1.5 font-mono text-[11px] leading-none text-muted-foreground shadow-tile dark:bg-surface"
        >
          <p.icon className="size-3 text-primary-icon" />
          {p.label}
        </li>
      ))}
    </ul>
  )
}
