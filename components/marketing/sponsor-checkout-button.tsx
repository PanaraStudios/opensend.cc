import type { ReactNode } from "react"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"
import type { SponsorTierId } from "@/content/landing"
import { sponsorCheckoutPath } from "@/lib/sponsor-checkout"

/** What every link to a tier's checkout carries: where it goes, and what
    analytics hears about the click. */
export function sponsorCheckoutLink(tier: SponsorTierId, section: string) {
  return {
    href: sponsorCheckoutPath(tier),
    "data-umami-event": "sponsor_cta",
    "data-umami-event-section": section,
    "data-umami-event-plan": tier,
  }
}

export function SponsorCheckoutButton({
  tier,
  section,
  size = "lg",
  variant = "default",
  className,
  children,
}: {
  tier: SponsorTierId
  section: string
  children: ReactNode
  className?: string
} & Pick<VariantProps<typeof buttonVariants>, "size" | "variant">) {
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      nativeButton={false}
      render={<a {...sponsorCheckoutLink(tier, section)} />}
    >
      {children}
    </Button>
  )
}
