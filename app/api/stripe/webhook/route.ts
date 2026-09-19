import Stripe from "stripe"

import { createCocomailContact } from "@/lib/cocomail"
import { sendMail } from "@/lib/mail"
import {
  customerEmailFromSession,
  getStripe,
  sponsorTierFromSession,
} from "@/lib/stripe-sponsors"
import { sponsorTier } from "@/content/landing"
import { SITE } from "@/content/site"

export const runtime = "nodejs"

function webhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim()
}

export async function POST(request: Request) {
  const stripe = getStripe()
  const secret = webhookSecret()
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
      await onCheckoutCompleted(event.data.object)
    } else if (event.type === "customer.subscription.deleted") {
      await onSubscriptionDeleted(stripe, event.data.object)
    }
  } catch (error) {
    console.error("Stripe webhook handler failed", error)
    return new Response("Webhook handler failed.", { status: 500 })
  }

  return new Response(null, { status: 200 })
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription" && session.mode !== "payment") return

  const email = customerEmailFromSession(session)
  const tierId = sponsorTierFromSession(session)
  if (!email || !tierId) {
    console.error("Sponsor checkout missing email or tier", {
      sessionId: session.id,
    })
    return
  }

  const plan = sponsorTier(tierId)

  await createCocomailContact({
    email,
    tags: ["opensend.cc", `opensend.cc-sponsor-${tierId}`],
  })

  const operator = await sendMail({
    to: SITE.email,
    subject: `New ${plan.name} sponsor: ${email}`,
    text: [
      `${email} paid for ${plan.name} (${plan.price}/month).`,
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
  })
  if (!operator.ok) {
    console.error("Could not email the operator", operator.message)
  }
}

async function onSubscriptionDeleted(
  stripe: Stripe,
  subscription: Stripe.Subscription
) {
  let email: string | null = null
  if (typeof subscription.customer === "string") {
    try {
      const customer = await stripe.customers.retrieve(subscription.customer)
      if (!customer.deleted) email = customer.email
    } catch (error) {
      console.error("Could not load Stripe customer", error)
    }
  } else if (subscription.customer && !subscription.customer.deleted) {
    email = subscription.customer.email
  }

  const result = await sendMail({
    to: SITE.email,
    subject: `Sponsor subscription ended${email ? `: ${email}` : ""}`,
    text: [
      "A sponsor subscription was cancelled or expired.",
      email ? `Customer: ${email}` : "Customer email was not on the record.",
      `Subscription: ${subscription.id}`,
      "",
      "Take the logo down if it is still on the site.",
    ].join("\n"),
  })
  if (!result.ok) {
    console.error("Could not email subscription end", result.message)
  }
}
