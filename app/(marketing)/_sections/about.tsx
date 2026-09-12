import Image from "next/image"

import { Reveal } from "@/components/marketing/motion"
import { SectionHeader } from "@/components/marketing/section-header"
import { ABOUT, COMPANY_URL } from "@/content/landing"

/* About: centered two-line header, the accent phrase on its own line, then
   the 96px photo, three sentences and two links. */
export function About() {
  return (
    <section id="about" className="section scroll-mt-16 px-6 md:px-10">
      <SectionHeader
        title={
          <>
            {ABOUT.titleA}
            <br />
            <em>{ABOUT.titleEm}</em>
          </>
        }
      />
      <Reveal className="mx-auto mt-14 flex max-w-2xl gap-5 max-sm:flex-col">
        <Image
          src="/landing/kamal.jpg"
          alt={ABOUT.photoAlt}
          width={96}
          height={96}
          className="size-24 shrink-0 rounded-md border border-border bg-muted object-cover"
        />
        <div className="flex flex-col gap-3">
          <p className="text-small leading-relaxed text-pretty text-muted-foreground">
            {ABOUT.body.before}
            <a
              href={COMPANY_URL}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:text-primary-hover"
            >
              {ABOUT.body.company}
            </a>
            {ABOUT.body.after}
          </p>
          <p className="flex items-center gap-2 text-small">
            {ABOUT.links.map((link, i) => (
              <span key={link.href} className="flex items-center gap-2">
                {i > 0 && <span className="text-faint-foreground">·</span>}
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:text-primary-hover"
                >
                  {link.label}
                </a>
              </span>
            ))}
          </p>
        </div>
      </Reveal>
    </section>
  )
}
