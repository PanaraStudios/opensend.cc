import { ArrowRight } from "@/components/marketing/icons"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import { Button } from "@/components/ui/button"
import { CTA, FINAL_CTA } from "@/content/landing"

/* Final CTA: display headline over a brand wash and the system dotgrid, so
   the closer stays in the page language instead of repeating the hero warp.
   Headline, line and button stagger in. */
export function FinalCta() {
  return (
    <section className="section px-6 py-28 md:px-10">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_65%_at_50%_50%,var(--brand-soft),transparent_72%)]" />
        <div className="absolute top-1/2 left-1/2 size-[26rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/12 blur-3xl dark:bg-primary/22" />
        <div className="dotgrid absolute inset-0 [mask-image:radial-gradient(ellipse_55%_60%_at_50%_50%,black_22%,transparent_76%)]" />
      </div>
      <Stagger className="relative flex flex-col items-center gap-6 text-center">
        <StaggerItem>
          <h2 className="display title-gradient max-w-2xl text-balance">
            {FINAL_CTA.titleA} <em>{FINAL_CTA.titleEm}</em>
          </h2>
        </StaggerItem>
        <StaggerItem>
          <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
            {FINAL_CTA.sub}
          </p>
        </StaggerItem>
        <StaggerItem>
          <Button
            size="xl"
            nativeButton={false}
            render={
              <a
                href={CTA.primaryHref}
                target="_blank"
                rel="noreferrer"
                data-umami-event="cta_click"
                data-umami-event-section="final-cta"
              />
            }
          >
            {CTA.primary}
            <ArrowRight />
          </Button>
        </StaggerItem>
      </Stagger>
    </section>
  )
}
