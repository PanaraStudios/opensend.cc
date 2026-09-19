import Stripe from "stripe"

import { parseSponsorTier } from "@/lib/sponsor-checkout"
import type { SponsorTierId } from "@/content/landing"

export type PaidSponsorCheckout = {
  sessionId: string
  email: string
  tier: SponsorTierId
}

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key)
}

export function sponsorTierFromSession(
  session: Stripe.Checkout.Session
): SponsorTierId | null {
  return (
    parseSponsorTier(session.client_reference_id) ??
    parseSponsorTier(session.metadata?.tier)
  )
}

export function customerEmailFromSession(session: Stripe.Checkout.Session) {
  return session.customer_details?.email ?? session.customer_email ?? null
}

/* Live Stripe lookup. The upload form must not render unless this returns
   a paid Gold/Silver checkout. `complete` alone is not enough. */
export async function confirmPaidSponsorCheckout(
  sessionId: string
): Promise<PaidSponsorCheckout | null> {
  const id = sessionId.trim()
  if (!id.startsWith("cs_")) return null

  const stripe = getStripe()
  if (!stripe) return null

  let session: Stripe.Checkout.Session
  try {
    session = await stripe.checkout.sessions.retrieve(id, {
      expand: ["subscription", "payment_intent"],
    })
  } catch (error) {
    console.error("Could not load Stripe session", error)
    return null
  }

  if (session.status !== "complete") return null
  if (session.payment_status !== "paid") return null
  if (session.mode !== "subscription" && session.mode !== "payment") return null

  const tier = sponsorTierFromSession(session)
  const email = customerEmailFromSession(session)
  if (!tier || !email) return null

  if (session.mode === "subscription") {
    const subscription = await paidSubscription(stripe, session.subscription)
    if (!subscription) return null
  }

  const intent = session.payment_intent
  if (intent && typeof intent === "object") {
    if (intent.status !== "succeeded") return null
  }

  return { sessionId: session.id, email, tier }
}

async function paidSubscription(
  stripe: Stripe,
  value: string | Stripe.Subscription | null
) {
  if (!value) return null
  try {
    const subscription =
      typeof value === "string"
        ? await stripe.subscriptions.retrieve(value)
        : value
    if (
      subscription.status !== "active" &&
      subscription.status !== "trialing"
    ) {
      return null
    }
    return subscription
  } catch (error) {
    console.error("Could not load Stripe subscription", error)
    return null
  }
}
