import type { Metadata } from "next"
import Link from "next/link"

import { CloudIcon } from "lucide-react"
import { GitHubIcon } from "@/components/marketing/github-icon"
import { WaitlistForm } from "@/components/marketing/waitlist-form"
import { Button } from "@/components/ui/button"
import { COMPANY_URL, GITHUB_URL, WAITLIST } from "@/content/landing"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.waitlist)

export default function WaitlistPage() {
  return (
    <section className="section px-6 py-28 max-md:py-20">
      <div className="relative flex flex-col items-center gap-6 text-center">
        <span className="pill">
          <CloudIcon strokeWidth={1.75} />
          {WAITLIST.label}
        </span>
        <h1 className="display title-gradient max-w-2xl text-balance">
          {WAITLIST.titleA} <em>{WAITLIST.titleEm}</em>
        </h1>
        <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
          {WAITLIST.sub}
        </p>
        <WaitlistForm />
        <p className="max-w-md text-caption text-faint-foreground">
          {WAITLIST.note}{" "}
          <a
            href={COMPANY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
          >
            panarastudios.in
          </a>
        </p>
        <Button
          variant="ghost"
          nativeButton={false}
          render={
            <Link href={GITHUB_URL} target="_blank" rel="noreferrer" />
          }
        >
          {WAITLIST.githubCta}
          <GitHubIcon />
        </Button>
      </div>
    </section>
  )
}
