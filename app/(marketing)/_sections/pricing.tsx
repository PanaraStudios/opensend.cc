import {
  ArrowRightIcon,
  CloudIcon,
  HouseIcon,
  MailIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { TierCard } from "@/components/marketing/tier-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PRICING } from "@/content/landing"

const TIER_ICONS: Record<(typeof PRICING.tiers)[number]["icon"], LucideIcon> = {
  home: HouseIcon,
  cloud: CloudIcon,
}

/* Two tiers side by side in the shared .frame + .panel shell: self-hosting
   is free forever and carries the primary button; the managed cloud is a
   clearly-labeled coming soon with a waitlist link. */
export function Pricing() {
  return (
    <section id="pricing" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {PRICING.titleA} <em>{PRICING.titleEm}</em>
          </>
        }
        description={PRICING.sub}
      />
      <Stagger className="mx-auto mt-14 grid w-full max-w-3xl min-w-0 gap-6 md:grid-cols-2">
        {PRICING.tiers.map((tier) => {
          const external = tier.cta.href.startsWith("http")
          return (
            <TierCard
              key={tier.id}
              icon={TIER_ICONS[tier.icon]}
              name={tier.name}
              badge={
                tier.featured ? (
                  <Badge variant="primary">
                    {"badge" in tier && tier.badge ? tier.badge : "Open source"}
                  </Badge>
                ) : null
              }
              tagline={tier.tagline}
              price={tier.price}
              priceNote={tier.priceNote}
              featured={tier.featured}
              includes={tier.includes}
              action={
                <Button
                  size="lg"
                  variant={tier.featured ? "default" : "secondary"}
                  nativeButton={false}
                  render={
                    <a
                      href={tier.cta.href}
                      {...(external
                        ? { target: "_blank", rel: "noreferrer" }
                        : {})}
                      data-umami-event="pricing_cta"
                      data-umami-event-plan={tier.id}
                    />
                  }
                >
                  {tier.id === "cloud" ? <CloudIcon /> : null}
                  {tier.cta.label}
                  {tier.id === "cloud" ? null : <ArrowRightIcon />}
                </Button>
              }
            />
          )
        })}
      </Stagger>
      <Reveal>
        <p className="mx-auto mt-6 max-w-3xl text-center text-caption text-faint-foreground">
          {PRICING.caption}
        </p>
        <p className="mt-3 text-center text-small text-muted-foreground">
          Questions?{" "}
          <a
            href={`mailto:${PRICING.contact.email}`}
            className="inline-flex items-center gap-1 text-primary hover:text-primary-hover"
          >
            <MailIcon className="size-3.5 shrink-0" />
            Email me
          </a>{" "}
          or message me on{" "}
          <a
            href={PRICING.contact.x}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            X
          </a>
          .
        </p>
      </Reveal>
    </section>
  )
}
