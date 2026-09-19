import type { Metadata } from "next"
import { CheckIcon } from "lucide-react"

import { SponsorSetupForm } from "@/components/marketing/sponsor-setup-form"
import { SPONSORS_THANKS } from "@/content/landing"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"
import { confirmPaidSponsorCheckout } from "@/lib/stripe-sponsors"

export const metadata: Metadata = pageMetadata(PAGES.sponsorThanks)
export const dynamic = "force-dynamic"

export default async function SponsorThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id: sessionId } = await searchParams
  const paid = sessionId ? await confirmPaidSponsorCheckout(sessionId) : null

  return (
    <section className="section px-6 py-28 max-md:py-20">
      <div className="relative flex flex-col items-center gap-6 text-center">
        <span className="pill">
          <CheckIcon strokeWidth={1.75} />
          {paid ? SPONSORS_THANKS.label : SPONSORS_THANKS.unpaidLabel}
        </span>
        <h1 className="display title-gradient max-w-2xl text-balance">
          {paid ? (
            <>
              {SPONSORS_THANKS.titleA} <em>{SPONSORS_THANKS.titleEm}</em>
            </>
          ) : (
            <>
              {SPONSORS_THANKS.unpaidTitleA}{" "}
              <em>{SPONSORS_THANKS.unpaidTitleEm}</em>
            </>
          )}
        </h1>
        <p className="max-w-xl text-body-lg text-balance text-muted-foreground">
          {paid ? SPONSORS_THANKS.sub : SPONSORS_THANKS.unpaidSub}
        </p>
        {paid ? (
          <SponsorSetupForm email={paid.email} sessionId={paid.sessionId} />
        ) : null}
      </div>
    </section>
  )
}
