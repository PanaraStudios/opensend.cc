/* All landing-page copy lives here so it can be edited without touching JSX.

   Order on the page: HERO, STACK, WHAT_YOU_GET, SELF_HOST, HOW_IT_WORKS,
   ABOUT, SPONSORS, TESTIMONIALS, PRICING, FAQ, FINAL_CTA. One idea per section, one or two lines of
   copy per element. If a line can be cut without losing a fact, cut it.

   Every feature carries `platforms` so the UI can show where it ships
   (api / smtp / dashboard).

   TODO(launch) marks copy that still needs a real value: the docs site,
   the support mailbox, testimonials. */

export const GITHUB_URL = "https://github.com/PanaraStudios/opensend.cc"
export const COMPANY_URL = "https://panarastudios.in"
export const PERSONAL_URL = "https://kamalpanara.com"
export const X_URL = "https://x.com/PanaraStudios"
export const YOUTUBE_URL = "https://www.youtube.com/panarastudios"
/* Docs are not written yet — this is an internal WIP page, not a fake site. */
export const DOCS_URL = "/docs"

export type Platform = "api" | "smtp" | "dashboard"

export const WAITLIST_URL = "/waitlist"
export const SPONSORS_URL = "/sponsors"

export type SponsorTierId = "gold" | "silver"

export const CONTACT_MAILTO = "mailto:hello@opensend.cc"

export const CTA = {
  primary: "Self-host",
  primaryHref: GITHUB_URL,
  secondary: "Join the Cloud waitlist",
  secondaryHref: WAITLIST_URL,
}

export const NAV = {
  links: [
    { href: "/#inside", label: "Features" },
    { href: "/#self-host", label: "Self-host" },
    { href: "/#pricing", label: "Pricing" },
    { href: SPONSORS_URL, label: "Sponsors" },
    { href: "/#faq", label: "FAQ" },
  ],
  github: { href: GITHUB_URL, label: "GitHub" },
}

/* ── 1. Hero ── */

export const HERO = {
  titleA: "The self-hosted",
  titleEm: "Resend alternative.",
  sub: "An open source email API you run on your own server. You pay Amazon to send. Nothing to us.",
  /* Byline under the buttons: one real face and a claim that is true today.
     Once there are real users, add their photos to `avatars` (3D
     portraits are in public/landing/avatars) and change lines[0] to a
     count. Initials stay as the fallback if a src is missing. Keep every
     number here honest. */
  social: {
    avatars: [{ initials: "KP", src: "/landing/kamal.jpg" }],
    lines: [
      "Built by Kamal Panara, Convex Champion.",
      "Apache-2.0. You only pay AWS to send.",
    ],
  },
}

/* ── 2. Stack strip ── */

export const STACK = {
  label: ["Self-hosted stack.", "Nothing rented."],
}

/* ── 3. What you get ── */

export const WHAT_YOU_GET = {
  titleA: "Send like Resend.",
  titleEm: "Own the stack.",
  sub: "A Resend-compatible API, AWS SES for delivery, and a dashboard on your server. One Docker Compose deploy.",
  shared: {
    label: "Set up once, on your server",
    items: [
      { icon: "globe" as const, label: "Domain + DNS" },
      { icon: "key-round" as const, label: "API keys" },
      { icon: "server" as const, label: "AWS SES" },
    ],
  },
  apps: [
    {
      id: "api" as Platform,
      icon: "send" as const,
      title: "Send",
      stack: "REST API · SDKs",
      body: "One POST sends an email. Point a Resend-style SDK at your opensend.cc URL. Keep your app code.",
    },
    {
      id: "smtp" as Platform,
      icon: "server" as const,
      title: "Deliver",
      stack: "AWS SES · SMTP",
      body: "Send through AWS SES or any SMTP relay. opensend.cc shows you the DKIM, SPF and DMARC records for your domain.",
    },
    {
      id: "dashboard" as Platform,
      icon: "browser" as const,
      title: "See",
      stack: "Next.js · self-hosted",
      body: "The dashboard shows domains, keys, logs and suppression. It uses Better Auth and stores data in Convex on your machine.",
    },
  ],
  features: [
    {
      icon: "code" as const,
      title: "Resend-compatible API",
      body: "Scoped keys, batch send and idempotent retries. Change the base URL on a Resend SDK. Requests go to your server.",
      platforms: ["api"] as Platform[],
    },
    {
      icon: "server" as const,
      title: "AWS SES and SMTP",
      body: "SES is the default relay. Plain SMTP is there for frameworks and plugins that already use it.",
      platforms: ["smtp"] as Platform[],
    },
    {
      icon: "file-code" as const,
      title: "Templates in React",
      body: "Build emails as React components, preview them in the dashboard and send them by name.",
      platforms: ["api", "dashboard"] as Platform[],
    },
    {
      icon: "dataflow" as const,
      title: "Webhooks",
      body: "Signed events for deliveries, bounces and complaints. opensend.cc posts them to your endpoints, with retries.",
      platforms: ["api", "dashboard"] as Platform[],
    },
    {
      icon: "users" as const,
      title: "Contacts and audiences",
      body: "Store contacts, group them into audiences and keep consent in your Convex database, not a vendor's.",
      platforms: ["api", "dashboard"] as Platform[],
    },
    {
      icon: "announcement" as const,
      title: "Broadcasts",
      body: "Send product updates and newsletters to an audience. They use the same SES pipeline as transactional mail.",
      platforms: ["api", "dashboard"] as Platform[],
    },
    {
      icon: "chart-column" as const,
      title: "Logs and analytics",
      body: "Every message, event and error is searchable. Bounces and complaints feed suppression automatically.",
      platforms: ["dashboard"] as Platform[],
    },
    {
      icon: "shield-tick" as const,
      title: "Deliverability",
      body: "Guided DKIM, SPF and DMARC on your domain. Your SES reputation stays yours. It is not shared with other customers.",
      platforms: ["smtp", "dashboard"] as Platform[],
    },
    {
      icon: "flask" as const,
      title: "Test mode",
      body: "Keys that accept everything and deliver nothing. Wire up CI and staging without emailing real users.",
      platforms: ["api", "smtp"] as Platform[],
    },
  ],
}

/* ── 4. Self-hosting ── */

export type StackLayer = { label: string; note: string; logo: string }

export const SELF_HOST = {
  titleA: "Your email. Your server.",
  titleEm: "Your AWS bill.",
  sub: "opensend.cc is one Docker Compose file. Next.js, self-hosted Convex, Better Auth, and AWS SES. Your domains, data, and accounts stay on your infrastructure.",
  /* Left panel: the stack one deploy sets up, top to bottom. `logo` is a
     file stem under /logos/stack. */
  stack: {
    title: "What you end up with",
    layers: [
      { logo: "docker", label: "Docker Compose", note: "one command" },
      { logo: "nextjs", label: "Next.js", note: "dashboard and API" },
      { logo: "convex", label: "Self-hosted Convex", note: "your database" },
      {
        logo: "better-auth",
        label: "Better Auth",
        note: "your accounts",
      },
      { logo: "aws", label: "AWS SES", note: "or any SMTP relay" },
    ] as StackLayer[],
  },
  /* Right panel: the setup steps, in order. */
  guide: {
    title: "How you get there",
    steps: [
      {
        icon: "container" as const,
        label: "Clone the repo and run Docker Compose",
      },
      {
        icon: "users" as const,
        label: "Sign in on your instance with Better Auth",
      },
      { icon: "globe" as const, label: "Add your domain and connect AWS SES" },
      {
        icon: "send" as const,
        label: "Create an API key and send your first email",
      },
    ],
  },
  /* Closes the section as one link line. */
  offer: {
    label: "Read the self-hosting guide",
    note: "In the repo: Docker Compose, AWS SES, Convex and Better Auth, step by step.",
    href: DOCS_URL,
  },
}

/* ── 5. How it works ── */

export const HOW_IT_WORKS = {
  titleEm: "Three steps",
  titleA: "from clone to first email.",
  steps: [
    {
      icon: "container" as const,
      title: "Deploy",
      body: "Clone the repo and run docker compose up. Next.js, Convex and Better Auth start on your machine.",
    },
    {
      icon: "link" as const,
      title: "Connect SES",
      body: "Add your sending domain. Publish the DKIM, SPF and DMARC records it shows you. Attach your AWS SES account.",
    },
    {
      icon: "send" as const,
      title: "Send",
      body: "Create an API key and POST your first email. Use curl, a Resend SDK or plain SMTP. See it in the logs.",
    },
  ],
}

/* ── 6. About ── */

export const ABOUT = {
  titleA: "Hey, I'm Kamal.",
  titleEm: "I got tired of renting Resend.",
  body: {
    before: "I run ",
    company: "Panara Studios",
    after:
      ", an app agency that's shipped products for clients in 10+ countries since 2021. Every app needed transactional email. Hosted APIs charged per send and hid the stack, so I built the open source Resend alternative I wanted.",
  },
  /* Rendered from public/landing/kamal.jpg. */
  photoAlt: "Kamal Panara",
  links: [
    { href: "https://x.com/codewithkamal", label: "@codewithkamal" },
    { href: PERSONAL_URL, label: "kamalpanara.com" },
  ],
}

/* ── 7. Testimonials ──
   TODO(launch): placeholders. Replace with real quotes, names and links from
   the first users before this goes live; never ship an invented quote.
   `live` keeps the section off the page until then; flip it to true to
   preview the layout or once the quotes are real. */

export const TESTIMONIALS = {
  live: false,
  titleA: "Sent with",
  titleEm: "opensend.cc.",
  sub: "What developers say after running it themselves.",
  items: [
    {
      quote:
        "Placeholder quote about leaving a per-email Resend plan for a VPS and AWS SES.",
      name: "Placeholder Name",
      role: "Founder, B2B SaaS",
      initials: "PN",
    },
    {
      quote:
        "Placeholder quote about pointing an existing Resend SDK at an opensend.cc base URL.",
      name: "Placeholder Name",
      role: "Indie developer",
      initials: "PN",
    },
    {
      quote:
        "Placeholder quote about keeping email data in self-hosted Convex next to the rest of the stack.",
      name: "Placeholder Name",
      role: "Agency owner",
      initials: "PN",
    },
    {
      quote:
        "Placeholder quote about test mode keeping staging from emailing real users.",
      name: "Placeholder Name",
      role: "Solo founder",
      initials: "PN",
    },
  ],
}

/* ── 8. Pricing ──
   Honest open-source pricing: self-hosting is free forever; a managed cloud
   is a clearly-labeled coming soon. A list item is a string, or an object
   when it carries a badge. */

export type PlanItem = string | { label: string; badge: string }

export const PRICING = {
  titleA: "Self-host it.",
  titleEm: "Pay Amazon, not us.",
  sub: "The software is open source and free. You pay for the VPS and AWS SES. You pay opensend.cc nothing.",
  tiers: [
    {
      id: "self-host",
      name: "Self-host",
      icon: "home" as const,
      tagline: "The whole platform, on your infrastructure.",
      price: "$0",
      priceNote: "forever",
      featured: true,
      badge: "Open source",
      cta: { label: "Self-host", href: GITHUB_URL },
      includes: [
        "Full source code, Apache-2.0",
        "Next.js, self-hosted Convex, and Better Auth",
        "AWS SES or any SMTP relay",
        "Resend-compatible REST API and SMTP",
        "Templates, audiences, broadcasts, webhooks and logs",
        "Community support on GitHub",
      ] satisfies PlanItem[],
    },
    {
      id: "cloud",
      name: "Cloud",
      icon: "cloud" as const,
      tagline: "Same API, we run the servers.",
      price: "$$",
      priceNote: "coming soon",
      featured: false,
      cta: {
        label: "Join the Cloud waitlist",
        href: WAITLIST_URL,
      },
      includes: [
        "Everything in Self-host",
        "We run Docker, Convex, Better Auth and updates",
        "Managed SES and deliverability",
        { label: "Waitlist open", badge: "Soon" },
      ] satisfies PlanItem[],
    },
  ],
  caption:
    "opensend.cc is open source. Self-hosting is free. You cover your own server and AWS SES costs.",
  /* TODO(launch): make sure this mailbox is live. It is the address
     /privacy already points to. */
  contact: {
    email: "hello@opensend.cc",
    x: X_URL,
  },
}

/* ── 9. FAQ ── */

export const FAQ = {
  titleA: "Questions people ask",
  titleEm: "before leaving Resend.",
  items: [
    {
      q: "How is opensend.cc different from Resend?",
      a: "You get the same developer experience: a Resend-compatible REST API, SDK-shaped clients, React templates and signed webhooks. You host it. Next.js, Convex and Better Auth run on your server. AWS SES sends the mail on your AWS account. There is no per-email fee to us.",
    },
    {
      q: "What stack does it run on?",
      a: "The app is Next.js. The database is self-hosted Convex. Accounts use Better Auth. AWS SES sends mail. Docker Compose runs it. None of those are a SaaS you rent from opensend.cc.",
    },
    {
      q: "Is it really free?",
      a: "The code is open source. Self-hosting is free. There is no per-email pricing and no feature gates. You pay for your VPS and AWS SES, or another SMTP relay. A managed Cloud is planned for teams that do not want to run Docker themselves.",
    },
    {
      q: "What do I need to self-host?",
      a: "You need a machine that runs Docker and a domain you can add DNS records to. You also need an AWS SES account, or any SMTP provider. Docker Compose starts Next.js, Convex and Better Auth together.",
    },
    {
      q: "Will my emails actually reach the inbox?",
      a: "Deliverability is mostly your domain and your SES reputation. You control both. opensend.cc guides DKIM, SPF and DMARC setup, record by record. Bounces and complaints feed a suppression list. Every message is logged.",
    },
    {
      q: "Can I use it commercially?",
      a: "Yes. The license covers commercial use, client work and modification. Run it for one product or fifty, on as many servers as you like.",
    },
    {
      q: "Is there a managed version?",
      a: "Not yet. opensend.cc Cloud is on the roadmap for teams that want the same API without running Docker, Convex or Better Auth. Join the waitlist in the pricing section. Self-hosting is ready from the repo.",
    },
    {
      q: "How do I sponsor opensend.cc?",
      a: "Gold is $249 a month and puts your logo on the homepage. Silver is $99 a month and lists you in the directory. Pay with Stripe. After payment, upload your logo on the next page. It stays up while you pay.",
    },
  ],
}

/* ── 10. Final CTA ── */

export const FINAL_CTA = {
  titleA: "Stop renting",
  titleEm: "your email API.",
  sub: "Clone the repo, run Docker Compose, and point your Resend SDK at your own server.",
}

/* ── Waitlist (Cloud) ── */

export const WAITLIST = {
  label: "Cloud",
  titleA: "Same API.",
  titleEm: "We run the servers.",
  sub: "opensend.cc Cloud is the managed version. We run Next.js, Convex, Better Auth and AWS SES. Self-host today if you want it on your machine now.",
  emailLabel: "Email",
  placeholder: "you@yourdomain.com",
  emptyEmail: "Enter your email",
  invalidEmail: "Enter a valid email",
  submit: "Join the Cloud waitlist",
  submitting: "Joining…",
  successTitle: "You're on the list.",
  alreadyJoined: "You're already on the list.",
  successBody: "We'll only write when Cloud is ready.",
  githubCta: "Or self-host from GitHub",
  note: "A product of Panara Studios. We'll only write when Cloud is ready.",
}

/* ── Sponsors
   Monthly Gold (homepage wall) and Silver (directory). Add a company to
   `items` with a tier and drop its mark in public/logos/sponsors.
   The logo stays up while the subscription is active. */

export type SponsorCategory =
  "Email" | "Auth" | "Databases" | "Hosting" | "Developer Tools" | "Other"

export type Sponsor = {
  name: string
  href: string
  category: SponsorCategory
  tier: SponsorTierId
  logo: {
    src: string
    srcDark?: string
    alt: string
    width?: number
    height?: number
  }
}

export const SPONSOR_CATEGORIES: SponsorCategory[] = [
  "Email",
  "Auth",
  "Databases",
  "Hosting",
  "Developer Tools",
  "Other",
]

export const SPONSOR_TIERS = [
  {
    id: "gold" as SponsorTierId,
    name: "Gold",
    icon: "award" as const,
    tagline: "Your logo on the homepage. Cancel any month.",
    price: "$249",
    priceNote: "a month",
    featured: true,
    badge: "Homepage",
    slots: 8,
    cta: { label: "Subscribe to Gold" },
    includes: [
      "Logo on the homepage wall",
      "Listing in the sponsor directory",
      "Gold badge on your row",
      "Link to your site",
      "A line to the maintainer",
    ],
  },
  {
    id: "silver" as SponsorTierId,
    name: "Silver",
    icon: "medal" as const,
    tagline: "Your logo in the directory. Cancel any month.",
    price: "$99",
    priceNote: "a month",
    featured: false,
    slots: 12,
    cta: { label: "Subscribe to Silver" },
    includes: [
      "Listing in the sponsor directory",
      "Silver badge on your row",
      "Link to your site",
    ],
  },
]

export function sponsorTier(id: SponsorTierId) {
  const plan = SPONSOR_TIERS.find((item) => item.id === id)
  if (!plan) throw new Error(`Unknown sponsor tier: ${id}`)
  return plan
}

export function sponsorsOnTier(id: SponsorTierId) {
  return SPONSORS.items.filter((item) => item.tier === id)
}

export function sponsorOpenCount(id: SponsorTierId) {
  return Math.max(0, sponsorTier(id).slots - sponsorsOnTier(id).length)
}

export const SPONSORS = {
  titleA: "This site stays free",
  titleEm: "because of sponsors.",
  sub: "Gold is $249 a month on the homepage. Silver is $99 a month in the directory. The logo stays up while you pay.",
  cta: { label: "See Gold and Silver", href: `${SPONSORS_URL}#spots` },
  openAction: "Subscribe",
  /* Real companies only. Empty until the first one pays. */
  items: [] as Sponsor[],
}

export const SPONSORS_PAGE = {
  label: "Sponsors",
  titleA: "Your logo on this site.",
  titleEm: "Pay each month to keep it up.",
  sub: "Gold puts you on the homepage. Silver lists you in the directory. Cancel any month and the logo comes down.",
  cta: { label: "See the spots", href: "#spots" },
  spots: {
    titleA: "Two spots.",
    titleEm: "Monthly.",
    caption:
      "Pay with card. After payment you upload the logo. It stays up while the subscription is active. A year up front is 10 months.",
  },
  directory: {
    kicker: "02 / Sponsor directory",
    title: "opensend.cc sponsors. Gold on the homepage. Silver in this list.",
    allFilter: "All",
    openStatus: "Open",
    openAction: "Subscribe",
    visitAction: "Visit site",
    emptyTitle: "This category is open",
    emptyFilter:
      "No sponsors in this category yet. Subscribe and be the first.",
  },
  partner: {
    kicker: "03 / Work with us",
    title: "Tell us what you're building. We'll pick Gold or Silver.",
    cta: { label: "Get in touch", href: CONTACT_MAILTO },
    benefits: [
      {
        icon: "megaphone" as const,
        title: "Your brand in front of developers who self-host email",
        body: "Gold sits on the homepage. Silver sits in the directory. The people who see it are choosing an email API they will run themselves.",
      },
      {
        icon: "messages" as const,
        title: "A line to the maintainer",
        body: "Gold includes a line to Kamal. A question, a call, or a bug that is blocking your team.",
      },
      {
        icon: "handshake" as const,
        title: "Monthly, not a one-off",
        body: "Pay each month with Stripe. Stop paying and the logo comes down the next month. No lock-in.",
      },
      {
        icon: "heart-handshake" as const,
        title: "Keep opensend.cc free",
        body: "This is not owned by a big tech company. Your money pays for the hours that keep the code public.",
      },
    ],
  },
}

export const SPONSORS_THANKS = {
  label: "Paid",
  titleA: "Payment received.",
  titleEm: "Upload your logo.",
  sub: "Company name, website, and a logo file. SVG or PNG. Dark-mode logo is optional.",
  unpaidLabel: "Sponsors",
  unpaidTitleA: "We could not confirm",
  unpaidTitleEm: "that payment.",
  unpaidSub:
    "The upload form only opens after Stripe confirms the payment. Use the return link from checkout, or write hello@opensend.cc.",
  form: {
    company: "Company name",
    website: "https://yourcompany.com",
    logo: "Logo (SVG, PNG, or WebP)",
    logoDark: "Dark-mode logo (optional)",
    submit: "Upload logo",
    submitting: "Uploading…",
    successTitle: "Got it.",
    successBody:
      "The logo goes up once it is on the site. It stays up while you pay.",
    error: "Could not upload. Try again in a moment.",
  },
}

/* ── 11. Footer ── */

export const FOOTER = {
  tagline: "The self-hosted Resend alternative.",
  copyright: "© 2026 Panara Studios.",
  company: { href: COMPANY_URL, label: "Panara Studios" },
  columns: [
    {
      title: "Product",
      links: [
        { href: "/#inside", label: "Features" },
        { href: "/#self-host", label: "Self-host" },
        { href: "/#pricing", label: "Pricing" },
        { href: SPONSORS_URL, label: "Sponsors" },
        { href: "/#faq", label: "FAQ" },
        { href: WAITLIST_URL, label: "Waitlist" },
      ],
    },
    {
      title: "Open source",
      links: [
        { href: GITHUB_URL, label: "GitHub" },
        { href: DOCS_URL, label: "Docs" },
        { href: "/license", label: "License" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/terms", label: "Terms" },
        { href: "/privacy", label: "Privacy" },
      ],
    },
  ],
  socials: [
    { href: X_URL, label: "X", icon: "x" as const },
    { href: GITHUB_URL, label: "GitHub", icon: "github" as const },
    { href: YOUTUBE_URL, label: "YouTube", icon: "youtube" as const },
  ],
}
