import Stripe from "stripe"

import { linkKey, sponsorPaymentLink } from "@/lib/sponsor-checkout"
import { SPONSOR_TIERS, type SponsorTierId } from "@/content/landing"

export type PaidSponsorCheckout = {
  sessionId: string
  email: string
  tier: SponsorTierId
}

let client: { key: string; stripe: Stripe } | null = null

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  if (client?.key !== key) client = { key, stripe: new Stripe(key) }
  return client.stripe
}

/** The tier that was bought, going by which Payment Link the checkout came
    through. Nothing the buyer can edit, such as the link's query string, has
    a say. */
export async function sponsorTierFromSession(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<SponsorTierId | null> {
  const link = session.payment_link
  if (!link) return null
  const url =
    typeof link === "string"
      ? (await stripe.paymentLinks.retrieve(link)).url
      : link.url
  const paidThrough = linkKey(url)
  return (
    SPONSOR_TIERS.find((tier) => sponsorPaymentLink(tier.id) === paidThrough)
      ?.id ?? null
  )
}

export function customerEmailFromSession(session: Stripe.Checkout.Session) {
  return session.customer_details?.email ?? session.customer_email ?? null
}

/** What Stripe charged, e.g. "USD 249.00". */
export function amountPaid(session: Stripe.Checkout.Session): string | null {
  if (session.amount_total === null || !session.currency) return null
  return `${session.currency.toUpperCase()} ${(session.amount_total / 100).toFixed(2)}`
}

/* Live Stripe lookup. The upload form must not render unless this returns
   a paid Gold/Silver checkout. `complete` alone is not enough: the
   subscription has to be running too. */
export async function confirmPaidSponsorCheckout(
  sessionId: string
): Promise<PaidSponsorCheckout | null> {
  const id = sessionId.trim()
  if (!id.startsWith("cs_")) return null

  const stripe = getStripe()
  if (!stripe) return null

  try {
    const session = await stripe.checkout.sessions.retrieve(id, {
      expand: ["subscription", "payment_link"],
    })
    if (session.status !== "complete") return null
    if (session.payment_status !== "paid") return null

    const subscription = session.subscription
    if (!subscription || typeof subscription === "string") return null
    if (
      subscription.status !== "active" &&
      subscription.status !== "trialing"
    ) {
      return null
    }

    const tier = await sponsorTierFromSession(stripe, session)
    const email = customerEmailFromSession(session)
    if (!tier || !email) return null

    return { sessionId: session.id, email, tier }
  } catch (error) {
    console.error("Could not load Stripe session", error)
    return null
  }
}
