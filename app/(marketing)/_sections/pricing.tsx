import {
  ArrowRightIcon,
  CheckIcon,
  CloudIcon,
  HouseIcon,
  MailIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { PRICING } from "@/content/landing"
import { cn } from "@/lib/utils"

const TIER_ICONS: Record<string, LucideIcon> = {
  home: HouseIcon,
  cloud: CloudIcon,
}

/* Two tiers side by side in the shared .frame + .panel shell: self-hosting
   is free forever and carries the primary button; the managed cloud is a
   clearly-labeled coming soon with a waitlist link. The featured card moves
   to the top when the cards stack. A list item that carries a badge shows
   it as a green pill after the label. */
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
          const Icon = TIER_ICONS[tier.icon]
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
                  {tier.featured && (
                    <Badge variant="primary">
                      {"badge" in tier && tier.badge
                        ? tier.badge
                        : "Open source"}
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
                <Button
                  size="lg"
                  variant={tier.featured ? "default" : "secondary"}
                  className="mt-5 w-full"
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
                <ul className="mt-6 flex flex-col gap-2.5 border-t border-border pt-6">
                  {tier.includes.map((item) => {
                    const label = typeof item === "string" ? item : item.label
                    const badge = typeof item === "string" ? null : item.badge
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
                          {badge && <Badge variant="success">{badge}</Badge>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </StaggerItem>
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
