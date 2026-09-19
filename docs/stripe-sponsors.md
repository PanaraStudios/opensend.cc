# Stripe sponsor spots

Gold ($249/month, homepage) and Silver ($99/month, directory) are **Stripe Payment Links**. After a successful payment, Stripe sends the buyer to `/sponsors/thanks?session_id=…`. That page asks Stripe again whether the session is `complete`, `payment_status=paid`, and (for Gold/Silver subscriptions) the subscription is `active` or `trialing`. The upload form does not render until that check passes. The submit action repeats the same check. We do not email the buyer. You get operator mail at `hello@opensend.cc` when someone pays, when they upload a logo, and when a subscription ends.

Local env lives in `.env.local`. Production env lives in the Next.js host (Vercel or similar). Never commit secrets.

## 1. Stripe products and prices

In [Stripe Dashboard → Product catalog](https://dashboard.stripe.com/products):

1. Create product **Gold sponsor**.
2. Add a **recurring** price: `$249 USD / month`.
3. Create product **Silver sponsor**.
4. Add a **recurring** price: `$99 USD / month`.

Use test mode first (`sk_test_…`). Repeat in live mode when you are ready.

## 2. Payment Links

In [Stripe Dashboard → Payment links](https://dashboard.stripe.com/payment-links):

For **Gold**:

1. New link → the Gold monthly price.
2. Collect the customer’s **email**.
3. After payment → **Don’t show confirmation page** → redirect to  
   `https://opensend.cc/sponsors/thanks?session_id={CHECKOUT_SESSION_ID}`  
   Local: `http://localhost:3000/sponsors/thanks?session_id={CHECKOUT_SESSION_ID}`  
   The `{CHECKOUT_SESSION_ID}` placeholder is literal. Stripe replaces it.
4. Copy the link (`https://buy.stripe.com/…`).

Repeat for **Silver**.

The app appends `client_reference_id=gold` or `silver` so the webhook knows the tier. Do not put that on the Dashboard URL yourself.

## 3. Webhook

In [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks):

1. Add endpoint  
   Production: `https://opensend.cc/api/stripe/webhook`  
   Local: use [Stripe CLI](https://stripe.com/docs/stripe-cli) (step 5).
2. Listen to:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
3. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

`checkout.session.completed` tags the buyer in Cocomail and mails you that they paid.  
`customer.subscription.deleted` mails you to take the logo down.

## 4. Next.js environment

Put these in `.env.local` (dev) and in the host’s env (prod):

```
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_GOLD=https://buy.stripe.com/...
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER=https://buy.stripe.com/...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_COCOMAIL_API_KEY=...
RESEND_API_KEY=...
```

| Variable                                 | Why                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_GOLD`   | Subscribe buttons for Gold                                                |
| `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_SILVER` | Subscribe buttons for Silver                                              |
| `STRIPE_SECRET_KEY`                      | Confirm the session on the thanks page and read the webhook               |
| `STRIPE_WEBHOOK_SECRET`                  | Verify Stripe signed the webhook                                          |
| `NEXT_COCOMAIL_API_KEY`                  | Tag the buyer on the waitlist tool (already used for Cloud waitlist)      |
| `RESEND_API_KEY`                         | Send _you_ the uploaded logo files. Without it, uploads cannot be mailed. |

Restart `pnpm dev` after changing `.env.local`. `NEXT_PUBLIC_*` values are baked in at boot.

Until the payment-link URLs are set, Subscribe shows **Checkout not ready**.

## 5. Local test

```sh
# terminal 1
pnpm dev

# terminal 2
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the CLI `whsec_…` into `.env.local` as `STRIPE_WEBHOOK_SECRET` (it is not the Dashboard secret).

Open `/sponsors`, pay with [test cards](https://docs.stripe.com/testing#cards) (`4242 4242 4242 4242`). You should land on `/sponsors/thanks?session_id=cs_test_…` and see the upload form. Upload an SVG or PNG. `hello@opensend.cc` should get the files.

Cancel the test subscription in Stripe. You should get the “take the logo down” mail.

## 6. Production

1. Switch Stripe to live mode. Create live products, prices, payment links, and a live webhook to `https://opensend.cc/api/stripe/webhook`.
2. Set live `sk_live_…`, `whsec_…`, and `https://buy.stripe.com/…` URLs on the host.
3. Redeploy so `NEXT_PUBLIC_*` links update.
4. Pay once with a real card, then refund/cancel.

## 7. After someone uploads

The form does not publish the logo by itself. When the operator mail arrives:

1. Save the files under `public/logos/sponsors/` (light + optional dark).
2. Add the company to `SPONSORS.items` in `content/landing.ts` with `tier: "gold"` or `"silver"`.
3. Deploy.

When a subscription ends, remove that entry and deploy again.

## 8. Files in this repo

| Path                                       | Role                                         |
| ------------------------------------------ | -------------------------------------------- |
| `lib/sponsor-checkout.ts`                  | Builds the Payment Link URL                  |
| `app/api/stripe/webhook/route.ts`          | Stripe webhook                               |
| `app/(marketing)/sponsors/thanks/page.tsx` | Upload form after payment                    |
| `app/actions/sponsor.ts`                   | Verifies the session and mails you the files |
| `.env.example`                             | Variable names                               |
