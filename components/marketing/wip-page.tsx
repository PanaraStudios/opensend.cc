import Link from "next/link"

import { ArrowRightIcon, type LucideIcon } from "lucide-react"
import { GitHubIcon } from "@/components/brand-icons"
import { Button } from "@/components/ui/button"
import { GITHUB_URL } from "@/content/landing"

/* Shared chrome for product pages that are linked but not built yet.
   Lives at the real path (e.g. /docs) so the URL bar stays intentional.
   Unknown URLs still hit the default 404. */
export function WipPage({
  label,
  description,
  icon: Icon,
}: {
  label: string
  description: string
  icon?: LucideIcon
}) {
  return (
    <section className="section px-6 py-28 max-md:py-20">
      <div className="relative flex flex-col items-center gap-6 px-0 text-center md:px-4">
        <span className="pill">
          {Icon ? <Icon strokeWidth={1.75} /> : null}
          {label}
        </span>
        <h1 className="display title-gradient max-w-2xl text-balance">
          This page is <em>still being built.</em>
        </h1>
        <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
          {description}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button
            size="xl"
            nativeButton={false}
            render={<Link href="/" />}
          >
            Back home
            <ArrowRightIcon />
          </Button>
          <Button
            size="xl"
            variant="secondary"
            nativeButton={false}
            render={
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" />
            }
          >
            <GitHubIcon />
            GitHub
          </Button>
        </div>
      </div>
    </section>
  )
}
