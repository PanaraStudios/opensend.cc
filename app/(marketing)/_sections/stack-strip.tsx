import { Reveal } from "@/components/marketing/motion"
import { STACK_LOGOS, StackLogoMark } from "@/components/marketing/stack-logos"
import { STACK } from "@/content/landing"

/* Logo marquee: a fixed label cell with a double-border separator (to the
   right on desktop, below on mobile), then an infinite scroll of 40px icon
   tiles. The track holds two identical sets and
   loops at translateX(-50%); the second set is hidden from assistive tech.
   Marks are full-color static SVGs shipped as light/dark pairs (see
   stack-logos.tsx); hover lifts the adjacent name to foreground. The marquee
   pauses on hover, and under reduced-motion it becomes a static, centered
   wrap (animation is already killed globally). */
export function StackStrip() {
  return (
    <section
      id="stack"
      aria-label="The stack"
      className="corners-b relative scroll-mt-16 border-double-b"
    >
      <Reveal className="flex items-stretch max-md:flex-col">
        <div className="relative flex shrink-0 items-center px-6 py-4 max-md:corners-b max-md:border-double-b md:corners md:px-10 md:border-double-r">
          <p className="text-body leading-snug font-medium">
            {STACK.label[0]}
            <br className="max-md:hidden" /> {STACK.label[1]}
          </p>
        </div>
        {/* the marks sit on this outer box; the inner one clips the track */}
        <div className="corners relative min-w-0 grow">
          <div className="flex h-full items-center overflow-hidden py-4">
            <div className="flex w-max animate-marquee hover:[animation-play-state:paused] motion-reduce:w-full motion-reduce:flex-wrap motion-reduce:justify-center motion-reduce:gap-y-6">
              {[0, 1].map((set) => (
                <div
                  key={set}
                  aria-hidden={set === 1}
                  className={
                    "flex items-center gap-8 pr-8" +
                    (set === 1 ? " motion-reduce:hidden" : "")
                  }
                >
                  {STACK_LOGOS.map((logo) => (
                    <div
                      key={logo.name}
                      className="group/logo flex items-center gap-2.5"
                    >
                      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface/50 shadow-tile dark:bg-surface">
                        <StackLogoMark logo={logo} className="size-6" />
                      </span>
                      <span className="text-body font-medium whitespace-nowrap text-muted-foreground transition-colors group-hover/logo:text-foreground">
                        {logo.name}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent motion-reduce:hidden"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent motion-reduce:hidden"
              aria-hidden="true"
            />
          </div>
        </div>
      </Reveal>
    </section>
  )
}
