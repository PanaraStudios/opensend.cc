"use client"

import { useEffect, useState } from "react"

import { Reveal } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel"
import { TESTIMONIALS } from "@/content/landing"
import { cn } from "@/lib/utils"

/* Testimonials: centered header, then a carousel of quote cards, three
   across on desktop. Each card is the shared .frame + .panel shell: quote
   on top, a 1px rule, then avatar, name and role. Round arrow buttons sit
   outside the track; dots below mirror the snap points, the active one
   stretched to 32px. */
export function Testimonials() {
  const [api, setApi] = useState<CarouselApi>()
  const [selected, setSelected] = useState(0)
  const [snaps, setSnaps] = useState<number[]>([])

  useEffect(() => {
    if (!api) return
    const sync = () => {
      setSnaps(api.scrollSnapList())
      setSelected(api.selectedScrollSnap())
    }
    sync()
    api.on("select", sync).on("reInit", sync)
    return () => {
      api.off("select", sync).off("reInit", sync)
    }
  }, [api])

  return (
    <section id="testimonials" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {TESTIMONIALS.titleA} <em>{TESTIMONIALS.titleEm}</em>
          </>
        }
        description={TESTIMONIALS.sub}
      />
      <Reveal className="mt-14">
        <Carousel
          setApi={setApi}
          opts={{ align: "start" }}
          className="relative mx-auto max-w-5xl"
        >
          <CarouselContent>
            {TESTIMONIALS.items.map((item) => (
              <CarouselItem
                key={item.quote}
                className="md:basis-1/2 lg:basis-1/3"
              >
                <figure className="frame h-full">
                  <div className="panel flex h-full flex-col gap-4">
                    <blockquote className="text-body text-foreground">
                      "{item.quote}"
                    </blockquote>
                    <figcaption className="mt-auto flex items-center gap-3 border-t border-border pt-4">
                      {/* TODO(launch): swap initials for the buyer's photo. */}
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-serif text-body text-faint-foreground italic"
                        aria-hidden="true"
                      >
                        {item.initials}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-small font-semibold">
                          {item.name}
                        </span>
                        <span className="text-caption font-normal text-muted-foreground">
                          {item.role}
                        </span>
                      </span>
                    </figcaption>
                  </div>
                </figure>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="max-[1119px]:hidden" />
          <CarouselNext className="max-[1119px]:hidden" />
        </Carousel>
        {snaps.length > 1 ? (
          <div className="mt-8 flex items-center justify-center gap-2">
            {snaps.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === selected}
                onClick={() => api?.scrollTo(i)}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === selected ? "w-8 bg-primary" : "w-2 bg-border-strong"
                )}
              />
            ))}
          </div>
        ) : null}
      </Reveal>
    </section>
  )
}
