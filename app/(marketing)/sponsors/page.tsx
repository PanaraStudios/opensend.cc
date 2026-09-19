import type { Metadata } from "next"
import {
  ArrowRightIcon,
  HandshakeIcon,
  HeartHandshakeIcon,
  MegaphoneIcon,
  MessagesSquareIcon,
  type LucideIcon,
} from "lucide-react"

import { Reveal, Stagger, StaggerItem } from "@/components/marketing/motion"
import { SponsorDirectory } from "@/components/marketing/sponsor-directory"
import { SponsorTiers } from "@/components/marketing/sponsor-tiers"
import { SponsorWall } from "@/components/marketing/sponsor-wall"
import { Button } from "@/components/ui/button"
import { SPONSORS_PAGE } from "@/content/landing"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.sponsors)

const BENEFIT_ICONS: Record<string, LucideIcon> = {
  megaphone: MegaphoneIcon,
  messages: MessagesSquareIcon,
  handshake: HandshakeIcon,
  "heart-handshake": HeartHandshakeIcon,
}

export default function SponsorsPage() {
  return (
    <>
      <Hero />
      <SponsorTiers />
      <Directory />
      <Partner />
    </>
  )
}

function Hero() {
  return (
    <section className="section pb-0">
      <div className="flex flex-col items-center gap-6 px-6 py-28 text-center max-md:py-20 md:px-10">
        <span className="pill">{SPONSORS_PAGE.label}</span>
        <h1 className="display title-gradient max-w-3xl text-balance">
          {SPONSORS_PAGE.titleA} <em>{SPONSORS_PAGE.titleEm}</em>
        </h1>
        <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
          {SPONSORS_PAGE.sub}
        </p>
        <Button
          size="xl"
          nativeButton={false}
          render={
            <a
              href={SPONSORS_PAGE.cta.href}
              data-umami-event="sponsor_cta"
              data-umami-event-section="hero"
            />
          }
        >
          {SPONSORS_PAGE.cta.label}
          <ArrowRightIcon />
        </Button>
      </div>
      <SponsorWall className="mt-6" />
    </section>
  )
}

function Directory() {
  const copy = SPONSORS_PAGE.directory
  return (
    <section id="directory" className="section scroll-mt-16 px-6 md:px-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start lg:gap-16">
        <Reveal>
          <span className="pill">{copy.kicker}</span>
          <p className="mt-4 text-body text-pretty text-muted-foreground">
            {copy.title}
          </p>
        </Reveal>
        <SponsorDirectory />
      </div>
    </section>
  )
}

function Partner() {
  const copy = SPONSORS_PAGE.partner
  return (
    <section id="work-with-us" className="section scroll-mt-16 px-6 md:px-10">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start lg:gap-16">
        <Reveal className="flex flex-col items-start gap-6">
          <span className="pill">{copy.kicker}</span>
          <h2 className="text-h3 text-pretty">{copy.title}</h2>
          <Button
            size="lg"
            nativeButton={false}
            render={
              <a
                href={copy.cta.href}
                data-umami-event="sponsor_cta"
                data-umami-event-section="partner"
              />
            }
          >
            {copy.cta.label}
            <ArrowRightIcon />
          </Button>
        </Reveal>
        <Stagger className="grid gap-4 sm:grid-cols-2">
          {copy.benefits.map((benefit) => {
            const Icon = BENEFIT_ICONS[benefit.icon]
            return (
              <StaggerItem key={benefit.title} className="frame">
                <div className="panel flex h-full flex-col gap-3">
                  {Icon ? (
                    <span className="icon-tile size-8 [&_svg]:size-4">
                      <Icon strokeWidth={1.5} />
                    </span>
                  ) : null}
                  <h3 className="text-small font-semibold">{benefit.title}</h3>
                  <p className="text-small text-muted-foreground">
                    {benefit.body}
                  </p>
                </div>
              </StaggerItem>
            )
          })}
        </Stagger>
      </div>
    </section>
  )
}
