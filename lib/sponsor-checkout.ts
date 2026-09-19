import type { SponsorTierId } from "@/content/landing"

/* Public Stripe Payment Link URLs. Created in the Stripe Dashboard as
   monthly subscriptions. Safe to expose: they are checkout pages. */

function paymentLink(tier: SponsorTierId) {
  return tier === "gold"
    ? process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_GOLD
    : process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER
}

export function sponsorCheckoutUrl(tier: SponsorTierId): string | null {
  const raw = paymentLink(tier)?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    url.searchParams.set("client_reference_id", tier)
    return url.toString()
  } catch {
    return null
  }
}

export function parseSponsorTier(value: unknown): SponsorTierId | null {
  return value === "gold" || value === "silver" ? value : null
}
