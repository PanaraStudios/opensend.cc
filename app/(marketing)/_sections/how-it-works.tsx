import {
  Container,
  Link,
  Send,
  type MarketingIcon,
} from "@/components/marketing/icons"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { HOW_IT_WORKS } from "@/content/landing"

const ICONS: Record<string, MarketingIcon> = {
  container: Container,
  link: Link,
  send: Send,
}

/* Three cells in a row: h3 and one line, with the step number set large and
   faint behind them in the cell's top-right corner, as a watermark. The
   number is clipped on its own where it crosses the cell's top edge, so the
   cell can stay unclipped for its corner marks. */
export function HowItWorks() {
  return (
    <section id="how-it-works" className="section scroll-mt-16 pb-0">
      <div className="px-6 md:px-10">
        <SectionHeader
          title={
            <>
              <em>{HOW_IT_WORKS.titleEm}</em> {HOW_IT_WORKS.titleA}
            </>
          }
        />
      </div>
      <Stagger className="grid-cells corners-t mt-14 grid border-double-t lg:grid-cols-3">
        {HOW_IT_WORKS.steps.map((step, i) => {
          const Icon = ICONS[step.icon]
          return (
            <StaggerItem
              key={step.title}
              className="relative flex flex-col gap-2 py-10"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -top-3 right-4 font-mono text-[6.5rem] leading-none font-medium tracking-tighter text-foreground/[0.05] select-none [clip-path:inset(0.75rem_0_0_0)]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="relative flex items-center gap-2.5 text-h4">
                {Icon ? (
                  <span className="icon-tile size-8 [&_svg]:size-4">
                    <Icon strokeWidth={1.5} />
                  </span>
                ) : null}
                <span>
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </span>
              </h3>
              <p className="relative text-small text-muted-foreground">
                {step.body}
              </p>
            </StaggerItem>
          )
        })}
      </Stagger>
    </section>
  )
}
