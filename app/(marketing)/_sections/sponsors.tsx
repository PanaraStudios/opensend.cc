import { ArrowRightIcon } from "lucide-react"
import Link from "next/link"

import { Reveal } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { SponsorWall } from "@/components/marketing/sponsor-wall"
import { Button } from "@/components/ui/button"
import { SPONSORS } from "@/content/landing"

/* Homepage sponsors: centered header, one buy button, then a full-bleed
   logo wall. Empty cells are spots for sale until SPONSORS.items is filled. */
export function Sponsors() {
  return (
    <section id="sponsors" className="section scroll-mt-16 pb-0">
      <div className="px-6 md:px-10">
        <SectionHeader
          title={
            <>
              {SPONSORS.titleA} <em>{SPONSORS.titleEm}</em>
            </>
          }
          description={SPONSORS.sub}
        />
        <Reveal className="mt-8 flex justify-center">
          <Button
            size="lg"
            nativeButton={false}
            render={
              <Link
                href={SPONSORS.cta.href}
                data-umami-event="sponsor_cta"
                data-umami-event-section="home"
              />
            }
          >
            {SPONSORS.cta.label}
            <ArrowRightIcon />
          </Button>
        </Reveal>
      </div>
      <SponsorWall className="mt-14" />
    </section>
  )
}
