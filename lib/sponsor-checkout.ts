import { SPONSOR_TIERS, type SponsorTierId } from "@/content/landing"

/* Where a Subscribe button points. The route behind it sends the buyer on to
   the tier's Stripe Payment Link, which is read when they click rather than
   when the site was built. */
export function sponsorCheckoutPath(tier: SponsorTierId): string {
  return `/sponsors/checkout/${tier}`
}

export function parseSponsorTier(value: unknown): SponsorTierId | null {
  return SPONSOR_TIERS.find((tier) => tier.id === value)?.id ?? null
}

/** The tier's Payment Link, made in the Stripe Dashboard as a monthly
    subscription. The NEXT_PUBLIC_ names are the older ones: they still work,
    but are fixed at build time. */
export function sponsorPaymentLink(tier: SponsorTierId): string | null {
  const raw =
    tier === "gold"
      ? (process.env.STRIPE_PAYMENT_LINK_GOLD ??
        process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_GOLD)
      : (process.env.STRIPE_PAYMENT_LINK_SILVER ??
        process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER)
  try {
    return raw?.trim() ? linkKey(raw.trim()) : null
  } catch {
    return null
  }
}

/** A Payment Link without its query string, for telling two apart. */
export function linkKey(url: string): string {
  const parsed = new URL(url)
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`
}
