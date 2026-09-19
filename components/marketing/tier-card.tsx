import { CheckIcon, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { StaggerItem } from "@/components/marketing/motion"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/* One plan in the shared .frame + .panel shell: product pricing and the
   sponsor spots both sell with it. The featured card moves to the top when
   the cards stack. A list item that carries a badge shows it as a green pill
   after the label. */
export function TierCard({
  icon: Icon,
  name,
  badge,
  tagline,
  price,
  priceNote,
  featured,
  action,
  includes,
  footer,
}: {
  icon: LucideIcon
  name: string
  badge?: ReactNode
  tagline: string
  price: string
  priceNote: string
  featured: boolean
  /** The button, which takes the full width under the price. */
  action: ReactNode
  includes: readonly (string | { label: string; badge?: string })[]
  footer?: ReactNode
}) {
  return (
    <StaggerItem className={cn("frame", featured && "max-md:order-first")}>
      <div className="panel flex h-full flex-col">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-h4">
            <Icon className="size-5 text-primary" strokeWidth={1.75} />
            {name}
          </h3>
          {badge}
        </div>
        <p className="mt-1 text-small text-muted-foreground">{tagline}</p>
        <div className="mt-5 flex items-baseline gap-2">
          <span className="text-h1">{price}</span>
          <span className="text-small text-muted-foreground">{priceNote}</span>
        </div>
        <div className="mt-5 flex flex-col">{action}</div>
        <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
          {includes.map((item) => {
            const label = typeof item === "string" ? item : item.label
            const pill = typeof item === "string" ? null : item.badge
            return (
              <li
                key={label}
                className="flex items-start gap-2.5 text-small text-muted-foreground"
              >
                <CheckIcon
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  strokeWidth={2.5}
                />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{label}</span>
                  {pill ? <Badge variant="success">{pill}</Badge> : null}
                </span>
              </li>
            )
          })}
        </ul>
        {footer}
      </div>
    </StaggerItem>
  )
}
