"use client"

import Image from "next/image"
import { ArrowRightIcon, PlusIcon } from "lucide-react"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import { SPONSOR_MAILTO, SPONSORS, type Sponsor } from "@/content/landing"
import { cn } from "@/lib/utils"

/* Logo wall of current sponsors plus empty cells you can buy. Shared by
   the homepage section and /sponsors. Add a company to SPONSORS.items
   and drop its mark in public/logos/sponsors. */

function sponsorOpenCount() {
  return Math.max(1, SPONSORS.wallSlots - SPONSORS.items.length)
}

export function SponsorMark({
  sponsor,
  className,
}: {
  sponsor: Sponsor
  className?: string
}) {
  const width = sponsor.logo.width ?? 160
  const height = sponsor.logo.height ?? 40
  const imgClass = cn("h-8 w-auto max-w-[10rem] object-contain", className)
  return (
    <>
      <Image
        src={sponsor.logo.src}
        alt={sponsor.logo.alt}
        width={width}
        height={height}
        className={cn(imgClass, sponsor.logo.srcDark && "dark:hidden")}
      />
      {sponsor.logo.srcDark ? (
        <Image
          src={sponsor.logo.srcDark}
          alt=""
          width={width}
          height={height}
          className={cn("hidden dark:block", imgClass)}
        />
      ) : null}
    </>
  )
}

export function SponsorWall({ className }: { className?: string }) {
  const open = sponsorOpenCount()
  return (
    <Stagger
      className={cn(
        "grid-cells corners-t grid border-double-t sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {SPONSORS.items.map((sponsor) => (
        <StaggerItem
          key={sponsor.name}
          className="flex min-h-32 items-center justify-center"
        >
          <a
            href={sponsor.href}
            target="_blank"
            rel="noreferrer"
            className="flex size-full items-center justify-center"
            data-umami-event="sponsor_logo"
            data-umami-event-name={sponsor.name}
          >
            <SponsorMark sponsor={sponsor} />
          </a>
        </StaggerItem>
      ))}
      {Array.from({ length: open }, (_, i) => (
        <StaggerItem
          key={`open-${i}`}
          className="flex min-h-32 items-center justify-center"
        >
          <OpenSlot />
        </StaggerItem>
      ))}
    </Stagger>
  )
}

function OpenSlot() {
  return (
    <a
      href={SPONSOR_MAILTO}
      className="flex size-full flex-col items-center justify-center gap-3 text-center"
      data-umami-event="sponsor_cta"
      data-umami-event-section="wall"
    >
      <span className="icon-tile">
        <PlusIcon strokeWidth={1.5} />
      </span>
      <span className="text-small text-muted-foreground">
        {SPONSORS.openLabel}
      </span>
      <span className="inline-flex items-center gap-1 text-caption font-medium text-primary">
        {SPONSORS.openAction}
        <ArrowRightIcon className="size-3.5 shrink-0" />
      </span>
    </a>
  )
}
