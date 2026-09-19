import {
  ArrowRightIcon,
  AwardIcon,
  MedalIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { SponsorCheckoutButton } from "@/components/marketing/sponsor-checkout-button"
import { TierCard } from "@/components/marketing/tier-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  SPONSOR_TIERS,
  SPONSORS_PAGE,
  sponsorOpenCount,
} from "@/content/landing"

const TIER_ICONS: Record<(typeof SPONSOR_TIERS)[number]["icon"], LucideIcon> = {
  award: AwardIcon,
  medal: MedalIcon,
}

/* Gold and Silver as monthly subscriptions, in the same cards as product
   pricing. Subscribe leaves for the tier's Stripe Payment Link. */
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
          const open = sponsorOpenCount(tier.id)
          return (
            <TierCard
              key={tier.id}
              icon={TIER_ICONS[tier.icon]}
              name={tier.name}
              badge={
                tier.badge ? (
                  <Badge variant="primary">{tier.badge}</Badge>
                ) : (
                  <Badge variant="secondary">{copy.spotsOpen(open)}</Badge>
                )
              }
              tagline={tier.tagline}
              price={tier.price}
              priceNote={tier.priceNote}
              featured={tier.featured}
              includes={tier.includes}
              action={
                open === 0 ? (
                  <Button size="lg" variant="secondary" disabled>
                    {copy.soldOut}
                  </Button>
                ) : (
                  <SponsorCheckoutButton
                    tier={tier.id}
                    section="spots"
                    variant={tier.featured ? "default" : "secondary"}
                  >
                    {tier.ctaLabel}
                    <ArrowRightIcon />
                  </SponsorCheckoutButton>
                )
              }
              footer={
                tier.featured ? (
                  <p className="mt-4 text-caption text-faint-foreground">
                    {copy.homepageOpen(open, tier.slots)}
                  </p>
                ) : null
              }
            />
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
