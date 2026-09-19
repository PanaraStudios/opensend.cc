import { SPONSORS_PAGE, sponsorOpenCount } from "@/content/landing"
import { parseSponsorTier, sponsorPaymentLink } from "@/lib/sponsor-checkout"

/* Subscribe buttons come here, and leave for the tier's Payment Link. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tier: string }> }
) {
  const tier = parseSponsorTier((await params).tier)
  if (!tier) return new Response("Not found.", { status: 404 })

  /* An old tab, or a link someone kept, may ask for a spot that has gone. */
  if (sponsorOpenCount(tier) === 0) {
    return new Response(SPONSORS_PAGE.spots.soldOutNotice, { status: 409 })
  }

  const link = sponsorPaymentLink(tier)
  if (!link) {
    console.error(`No Stripe Payment Link is set for the ${tier} tier`)
    return new Response(SPONSORS_PAGE.spots.checkoutUnavailable, {
      status: 503,
    })
  }
  return Response.redirect(link, 307)
}
