import { ArrowRightIcon, CloudIcon } from "lucide-react"
import Image from "next/image"
import Link from "next/link"

import { Stagger, StaggerItem } from "@/components/marketing/motion"
import { Button } from "@/components/ui/button"
import { CTA, HERO } from "@/content/landing"

/* Hero: headline, one line, two buttons, then the avatar stack. The
   four blocks rise in one after another on load. */
export function Hero() {
  return (
    <section className="section py-28 max-md:py-20">
      <Stagger className="flex flex-col items-center gap-6 px-6 text-center md:px-10">
        <StaggerItem>
          <h1 className="display title-gradient max-w-3xl text-balance">
            {HERO.titleA} <em>{HERO.titleEm}</em>
          </h1>
        </StaggerItem>
        <StaggerItem>
          <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
            {HERO.sub}
          </p>
        </StaggerItem>
        <StaggerItem className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="xl"
            nativeButton={false}
            render={
              <a
                href={CTA.primaryHref}
                target="_blank"
                rel="noreferrer"
                data-umami-event="cta_click"
                data-umami-event-section="hero"
              />
            }
          >
            {CTA.primary}
            <ArrowRightIcon />
          </Button>
          <Button
            size="xl"
            variant="secondary"
            nativeButton={false}
            render={<Link href={CTA.secondaryHref} />}
          >
            <CloudIcon />
            {CTA.secondary}
          </Button>
        </StaggerItem>
        <StaggerItem className="mt-2">
          <SocialProof />
        </StaggerItem>
      </Stagger>
    </section>
  )
}

/* 32px discs overlapping by 12px, each with a 2px ring in the page
   background so they read as separate coins, then two lines of text. One
   disc today (the founder's photo); grows into a stack once real buyers
   are added to HERO.social.avatars. */
function SocialProof() {
  return (
    <div className="flex items-center gap-3 max-sm:flex-col max-sm:gap-2">
      <div className="flex" aria-hidden="true">
        {HERO.social.avatars.map((avatar, i) => (
          <span
            key={avatar.initials}
            className={
              "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted font-mono text-[10px] font-medium text-muted-foreground shadow-card " +
              (i > 0 ? "-ml-3" : "")
            }
          >
            {avatar.src ? (
              <Image
                src={avatar.src}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            ) : (
              avatar.initials
            )}
          </span>
        ))}
      </div>
      <p className="text-caption leading-snug text-foreground max-sm:text-center sm:text-left">
        {HERO.social.lines[0]}
        <br />
        <span className="text-muted-foreground">{HERO.social.lines[1]}</span>
      </p>
    </div>
  )
}
