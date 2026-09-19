"use client"

import Image from "next/image"
import { ArrowRightIcon, PlusIcon } from "lucide-react"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import {
  SPONSORS,
  sponsorOpenCount,
  sponsorTier,
  sponsorsOnTier,
  type Sponsor,
} from "@/content/landing"
import { sponsorCheckoutUrl } from "@/lib/sponsor-checkout"
import { cn } from "@/lib/utils"

/* Gold logo wall. Silver does not appear here. Open cells are Gold
   subscriptions for sale. */

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
  const gold = sponsorsOnTier("gold")
  const open = sponsorOpenCount("gold")
  return (
    <Stagger
      className={cn(
        "grid-cells corners-t grid border-double-t sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {gold.map((sponsor) => (
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
  const gold = sponsorTier("gold")
  const href = sponsorCheckoutUrl("gold")
  const inner = (
    <>
      <span className="icon-tile">
        <PlusIcon strokeWidth={1.5} />
      </span>
      <span className="text-small text-muted-foreground">
        {gold.name} · {gold.price}/mo
      </span>
      <span className="inline-flex items-center gap-1 text-caption font-medium text-primary">
        {SPONSORS.openAction}
        <ArrowRightIcon className="size-3.5 shrink-0" />
      </span>
    </>
  )
  if (!href) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 text-center">
        {inner}
      </div>
    )
  }
  return (
    <a
      href={href}
      className="flex size-full flex-col items-center justify-center gap-3 text-center"
      data-umami-event="sponsor_cta"
      data-umami-event-section="wall"
      data-umami-event-plan="gold"
    >
      {inner}
    </a>
  )
}
