import {
  ArrowRightIcon,
  AwardIcon,
  CheckIcon,
  MedalIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SponsorCheckoutButton } from "@/components/marketing/sponsor-checkout-button"
import {
  SPONSOR_TIERS,
  SPONSORS_PAGE,
  sponsorOpenCount,
} from "@/content/landing"
import { cn } from "@/lib/utils"

const TIER_ICONS: Record<string, LucideIcon> = {
  award: AwardIcon,
  medal: MedalIcon,
}

/* Gold and Silver as monthly subscriptions. Same frame + panel cards as
   product pricing. Subscribe opens the Stripe Payment Link. */
export function SponsorTiers() {
  const copy = SPONSORS_PAGE.spots
  return (
    <section id="spots" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {copy.titleA} <em>{copy.titleEm}</em>
          </>
        }
      />
      <Stagger className="mx-auto mt-14 grid w-full max-w-3xl min-w-0 gap-6 md:grid-cols-2">
        {SPONSOR_TIERS.map((tier) => {
          const Icon = TIER_ICONS[tier.icon]
          const open = sponsorOpenCount(tier.id)
          return (
            <StaggerItem
              key={tier.id}
              className={cn("frame", tier.featured && "max-md:order-first")}
            >
              <div className="panel flex h-full flex-col">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-h4">
                    {Icon ? (
                      <Icon
                        className="size-5 text-primary"
                        strokeWidth={1.75}
                      />
                    ) : null}
                    {tier.name}
                  </h3>
                  {tier.featured && tier.badge ? (
                    <Badge variant="primary">{tier.badge}</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {open} {open === 1 ? "spot" : "spots"} open
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-small text-muted-foreground">
                  {tier.tagline}
                </p>
                <div className="mt-5 flex items-baseline gap-2">
                  <span className="text-h1">{tier.price}</span>
                  <span className="text-small text-muted-foreground">
                    {tier.priceNote}
                  </span>
                </div>
                {open === 0 ? (
                  <Button
                    size="lg"
                    variant="secondary"
                    className="mt-5 w-full"
                    disabled
                  >
                    Sold out
                  </Button>
                ) : (
                  <SponsorCheckoutButton
                    tier={tier.id}
                    section="spots"
                    size="lg"
                    variant={tier.featured ? "default" : "secondary"}
                    className="mt-5 w-full"
                  >
                    {tier.cta.label}
                    <ArrowRightIcon />
                  </SponsorCheckoutButton>
                )}
                <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
                  {tier.includes.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-small text-muted-foreground"
                    >
                      <CheckIcon
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        strokeWidth={2.5}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                {tier.featured ? (
                  <p className="mt-4 text-caption text-faint-foreground">
                    {open} of {tier.slots} homepage spots open
                  </p>
                ) : null}
              </div>
            </StaggerItem>
          )
        })}
      </Stagger>
      <Reveal>
        <p className="mx-auto mt-6 max-w-3xl text-center text-caption text-faint-foreground">
          {copy.caption}
        </p>
      </Reveal>
    </section>
  )
}
