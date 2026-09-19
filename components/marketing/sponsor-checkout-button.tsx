import type { ReactNode } from "react"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"
import type { SponsorTierId } from "@/content/landing"
import { sponsorCheckoutUrl } from "@/lib/sponsor-checkout"

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
  const href = sponsorCheckoutUrl(tier)
  if (!href) {
    return (
      <Button size={size} variant="secondary" className={className} disabled>
        Checkout not ready
      </Button>
    )
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      nativeButton={false}
      render={
        <a
          href={href}
          data-umami-event="sponsor_cta"
          data-umami-event-section={section}
          data-umami-event-plan={tier}
        />
      }
    >
      {children}
    </Button>
  )
}
