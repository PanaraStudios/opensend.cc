import Stripe from "stripe"

import { createCocomailContact } from "@/lib/cocomail"
import { sendMail } from "@/lib/mail"
import {
  amountPaid,
  customerEmailFromSession,
  getStripe,
  sponsorTierFromSession,
} from "@/lib/stripe-sponsors"
import { sponsorTier } from "@/content/landing"
import { SITE } from "@/content/site"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const stripe = getStripe()
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  const signature = request.headers.get("stripe-signature")
  if (!stripe || !secret || !signature) {
    return new Response("Stripe is not configured.", { status: 500 })
  }

  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret)
  } catch (error) {
    console.error("Stripe webhook signature failed", error)
    return new Response("Invalid signature.", { status: 400 })
  }

  try {
    if (event.type === "checkout.session.completed") {
      await onCheckoutCompleted(stripe, event.data.object)
    } else if (event.type === "customer.subscription.deleted") {
      await onSubscriptionDeleted(stripe, event.data.object)
    }
  } catch (error) {
    console.error("Stripe webhook handler failed", error)
    return new Response("Webhook handler failed.", { status: 500 })
  }

  return new Response(null, { status: 200 })
}

async function onCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session
) {
  /* Other products may check out on the same Stripe account. */
  if (!session.payment_link) return

  const email = customerEmailFromSession(session)
  const tierId = await sponsorTierFromSession(stripe, session)
  if (!email || !tierId) {
    console.error("Sponsor checkout missing email or tier", {
      sessionId: session.id,
    })
    return
  }

  const plan = sponsorTier(tierId)

  const [, operator] = await Promise.all([
    createCocomailContact({
      email,
      tags: ["opensend.cc", `opensend.cc-sponsor-${tierId}`],
    }),
    sendMail({
      to: SITE.email,
      subject: `New ${plan.name} sponsor: ${email}`,
      text: [
        `${email} paid ${amountPaid(session) ?? "an unknown amount"} for ${plan.name}.`,
        "",
        `Stripe session: ${session.id}`,
        session.subscription
          ? `Subscription: ${String(session.subscription)}`
          : "",
        "",
        "They should upload the logo on the thanks page after checkout.",
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  ])
  /* Thrown so the webhook answers 500 and Stripe sends the event again:
     a sponsor who paid must not go unnoticed. Nothing above is undone by a
     second run, as tagging a contact twice changes nothing. */
  if (!operator.ok) {
    throw new Error(`Could not email the operator: ${operator.message}`)
  }
}

async function onSubscriptionDeleted(
  stripe: Stripe,
  subscription: Stripe.Subscription
) {
  /* Other products may run subscriptions on the same Stripe account. A
     sponsor's is the one whose checkout came through a tier's link. */
  const sessions = await stripe.checkout.sessions.list({
    subscription: subscription.id,
    limit: 1,
  })
  const session = sessions.data[0]
  const tierId = session ? await sponsorTierFromSession(stripe, session) : null
  if (!session || !tierId) return

  const email = customerEmailFromSession(session)
  const plan = sponsorTier(tierId)
  const result = await sendMail({
    to: SITE.email,
    subject: `${plan.name} sponsor subscription ended${email ? `: ${email}` : ""}`,
    text: [
      `A ${plan.name} sponsor subscription was cancelled or expired.`,
      email ? `Customer: ${email}` : "Customer email was not on the record.",
      `Subscription: ${subscription.id}`,
      `Stripe session: ${session.id}`,
      "",
      "Take the logo down if it is still on the site.",
    ].join("\n"),
  })
  if (!result.ok) {
    throw new Error(`Could not email subscription end: ${result.message}`)
  }
}
