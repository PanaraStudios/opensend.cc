# Production runbook: Stripe sponsor spots

This is the live path for [opensend.cc/sponsors](https://opensend.cc/sponsors). Gold is **$249/month** (homepage). Silver is **$99/month** (directory). After Stripe confirms the payment, the buyer uploads a logo. We do not email the buyer. `info@panarastudios.in` gets mail when someone pays, when they upload, and when a subscription ends.

Do this in **live mode**. Test mode links will not take real cards.

---

## 0. Before you start

You need:

- A Stripe account that can charge live cards (business details and bank account completed). [Activate Stripe](https://dashboard.stripe.com/account/onboarding) if the dashboard still says test-only.
- Access to set environment variables on whatever hosts `opensend.cc` (Vercel, Railway, etc.) . The payment links are read when someone clicks Subscribe, so changing them needs no rebuild.
- A Resend API key (or another sender already wired in `lib/mail.ts`) so uploaded logos can be mailed to `info@panarastudios.in`.
- The Cocomail key already used for the Cloud waitlist (`NEXT_COCOMAIL_API_KEY`).

Keep a second browser window on this file while you click through Stripe.

---

## 1. Switch Stripe to live mode

1. Open [dashboard.stripe.com](https://dashboard.stripe.com).
2. Toggle **Test mode** **off** (top right). The sidebar should no longer say “Test”.
3. Confirm **Developers → API keys** shows a **Secret key** starting with `sk_live_`. Copy it. You will paste it later. Never commit it.

---

## 2. Create the two products

[Product catalog](https://dashboard.stripe.com/products) → **Add product**.

### Gold

1. Name: `Gold sponsor`
2. Description (optional): `Homepage logo on opensend.cc. Cancel any month.`
3. Pricing: **Recurring** → **$249.00 USD** → **Monthly**
4. Save

### Silver

1. Name: `Silver sponsor`
2. Description (optional): `Directory listing on opensend.cc. Cancel any month.`
3. Pricing: **Recurring** → **$99.00 USD** → **Monthly**
4. Save

---

## 3. Create the two Payment Links

[Payment links](https://dashboard.stripe.com/payment-links) → **New**.

Do Gold, then Silver. Settings that matter:

1. Product: the Gold or Silver monthly price from step 2.
2. Quantity: 1 (do not allow customers to change quantity).
3. **Customers: collect email address.** Required. The thanks page will not show the upload form without an email on the session.
4. After payment: **Don’t show a confirmation page** → **Redirect to your website**:

   ```
   https://opensend.cc/sponsors/thanks?session_id={CHECKOUT_SESSION_ID}
   ```

   Paste that exactly. `{CHECKOUT_SESSION_ID}` is a Stripe placeholder. Do not replace it with a real id.

5. Payments: cards on. No trial.
6. Create the link. Copy the public URL (`https://buy.stripe.com/…`).

Repeat for Silver. You now have two `buy.stripe.com` URLs.

The app tells Gold from Silver by which Payment Link the checkout came through, so paste each link exactly as Stripe gives it. Nothing in the URL a buyer can edit decides the tier.

---

## 4. Create the live webhook

[Developers → Webhooks](https://dashboard.stripe.com/webhooks) → **Add endpoint**.

1. Endpoint URL:

   ```
   https://opensend.cc/api/stripe/webhook
   ```

2. Events to send (select these two only):
   - `checkout.session.completed`
   - `customer.subscription.deleted`

3. Add endpoint.
4. Open the endpoint → **Signing secret** → **Reveal** → copy `whsec_…`. This is `STRIPE_WEBHOOK_SECRET`. It is not the API secret key.

`checkout.session.completed` tags the buyer in Cocomail and mails you that they paid.  
`customer.subscription.deleted` mails you to take the logo down.

---

## 5. Set Next.js env on the production host

Set these on the service that builds and serves `opensend.cc`. Names must match exactly.

```
STRIPE_PAYMENT_LINK_GOLD=https://buy.stripe.com/....   # Gold link from step 3
STRIPE_PAYMENT_LINK_SILVER=https://buy.stripe.com/.... # Silver link from step 3
STRIPE_SECRET_KEY=sk_live_....
STRIPE_WEBHOOK_SECRET=whsec_....
NEXT_COCOMAIL_API_KEY=....
RESEND_API_KEY=re_....
```

| Variable | Must start with | Used for |
| --- | --- | --- |
| `STRIPE_PAYMENT_LINK_GOLD` | `https://buy.stripe.com/` | Gold Subscribe buttons |
| `STRIPE_PAYMENT_LINK_SILVER` | `https://buy.stripe.com/` | Silver Subscribe buttons |
| `STRIPE_SECRET_KEY` | `sk_live_` | Confirm payment before the upload form |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` | Verify Stripe signed the webhook |
| `NEXT_COCOMAIL_API_KEY` | (your key) | Tag the buyer |
| `RESEND_API_KEY` | `re_` | Mail you the uploaded files |

Rules:

- Live keys only. `sk_test_` / test Payment Links will not work on production cards.
- The two Payment Link URLs are read when someone clicks Subscribe. Changing them needs a restart of the app at most, never a rebuild.
- Until a tier's URL is set, its Subscribe button leads to a page that says **Checkout is not set up yet**.
- `MAIL_FROM` is optional. Set it when the address people write to (in `content/site.ts`) is on a domain your mail provider has not verified.

---

## 6. Check the buttons

Restart the app so it sees the new values, then open [opensend.cc/sponsors](https://opensend.cc/sponsors) and click **Subscribe to Gold**. You go through `/sponsors/checkout/gold` and land on `buy.stripe.com`. If you get **Checkout is not set up yet** instead, `STRIPE_PAYMENT_LINK_GOLD` is missing or is not a URL.

---

## 7. Smoke-test with a real card

Do this once, then refund/cancel.

1. Subscribe Gold (or Silver) with a real card.
2. After pay, the browser must go to  
   `https://opensend.cc/sponsors/thanks?session_id=cs_live_…`
3. You must see **Payment received. Upload your logo.** and the file fields. If you see “We could not confirm that payment”, Stripe did not report `payment_status=paid` (wrong success URL, test/live mix, or webhook/secret mismatch on a later submit).
4. Upload a small SVG or PNG. `info@panarastudios.in` should receive the files.
5. In Stripe → **Customers / Subscriptions**, cancel that test subscription. You should get the “take the logo down” mail.
6. Refund the charge if you want the money back.

Stripe Dashboard → Developers → Webhooks → the endpoint → **Attempts** should show `200` for `checkout.session.completed`. A `400` is a bad signing secret. A `500` is app/env.

---

## 8. After a real sponsor uploads

The form does not publish the logo. When the mail arrives:

1. Save the files under `public/logos/sponsors/` (light, and dark if they sent one).
2. Add them to `SPONSORS.items` in `content/landing.ts`:

   ```ts
   {
     name: "Acme",
     href: "https://acme.com",
     category: "Email",
     tier: "gold", // or "silver"
     logo: {
       src: "/logos/sponsors/acme.svg",
       srcDark: "/logos/sponsors/acme-dark.svg", // optional
       alt: "Acme",
     },
   }
   ```

3. Deploy.

When Stripe mails you that the subscription ended, remove that entry and deploy again.

---

## 9. If it fails

| What you see | Likely cause |
| --- | --- |
| **Checkout not ready** | `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_*` empty, or deploy did not rebuild |
| Stripe page loads, then return URL is wrong | Payment Link success URL missing `?session_id={CHECKOUT_SESSION_ID}` |
| Thanks page: could not confirm payment | `STRIPE_SECRET_KEY` missing/test key, session unpaid, or the checkout did not come through the Gold or Silver link set in the env |
| Subscribe says the spots are sold out | Every slot of that tier in `SPONSOR_TIERS` has a sponsor in `SPONSORS.items` |
| Upload says "We already have your logo" | That checkout already sent one in. The mark is `logo_submitted` in the Checkout Session's metadata; clear it in the Dashboard to let them send again |
| Webhook 400 | `STRIPE_WEBHOOK_SECRET` is the test secret or the CLI secret |
| Webhook 500 | App error, or the operator mail could not be sent. Stripe sends the event again; check host logs |
| Upload fails with "Could not send the logo" | No mail got out. With `RESEND_API_KEY` set the mail goes through Resend, otherwise through Cocomail. Either way the domain of `MAIL_FROM` has to be verified with that provider |
| Live card declined | Stripe account not fully activated |

---

## Repo map

| Path | Role |
| --- | --- |
| `lib/sponsor-checkout.ts` | Builds the Payment Link URL |
| `lib/stripe-sponsors.ts` | Confirms the session is paid before the form |
| `app/api/stripe/webhook/route.ts` | Stripe webhook |
| `app/(marketing)/sponsors/thanks/page.tsx` | Upload form after payment |
| `app/actions/sponsor.ts` | Re-checks payment, mails you the files |
| `.env.example` | Variable names |
