import type { Metadata } from "next"
import Link from "next/link"

import { ArrowRightIcon, type LucideIcon } from "lucide-react"
import { GitHubIcon } from "@/components/brand-icons"
import { Button } from "@/components/ui/button"
import { GITHUB_URL } from "@/content/landing"

export type StatusCopy = {
  code: string
  icon?: LucideIcon
  title: string
  titleEm: string
  description: string
}

/** Status pages are not real routes: no canonical, never indexed. */
export function statusMetadata(copy: StatusCopy): Metadata {
  return {
    title: `${copy.title} ${copy.titleEm}`,
    description: copy.description,
    robots: { index: false, follow: true },
  }
}

export function HttpStatusPage({
  copy,
  children,
}: {
  copy: StatusCopy
  children?: React.ReactNode
}) {
  const Icon = copy.icon
  return (
    <section className="section px-6 py-28 max-md:py-20">
      <div className="relative flex flex-col items-center gap-6 px-0 text-center md:px-4">
        <span className="pill">
          {Icon ? <Icon strokeWidth={1.75} /> : null}
          {copy.code}
        </span>
        <h1 className="display title-gradient max-w-2xl text-balance">
          {copy.title} <em>{copy.titleEm}</em>
        </h1>
        <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
          {copy.description}
        </p>
        {children ? (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Status page with the default way out: home and the repo. */
export function PublicStatusPage({ copy }: { copy: StatusCopy }) {
  return (
    <HttpStatusPage copy={copy}>
      <StatusHomeButton />
      <StatusGitHubButton />
    </HttpStatusPage>
  )
}

export function StatusHomeButton() {
  return (
    <Button size="xl" nativeButton={false} render={<Link href="/" />}>
      Back home
      <ArrowRightIcon />
    </Button>
  )
}

export function StatusGitHubButton() {
  return (
    <Button
      size="xl"
      variant="secondary"
      nativeButton={false}
      render={<a href={GITHUB_URL} target="_blank" rel="noreferrer" />}
    >
      <GitHubIcon />
      GitHub
    </Button>
  )
}
