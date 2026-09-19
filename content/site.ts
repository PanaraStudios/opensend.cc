/* Site-wide identity used by <head> metadata, JSON-LD and the OG image.
   Page copy lives in content/landing.ts; this is only what search engines
   and link previews read. */

export const SITE = {
  name: "opensend.cc",
  url: "https://opensend.cc",
  email: "info@panarastudios.in",
  /* Under 60 characters so it is not cut in search results. */
  title: "opensend.cc: the self-hosted Resend alternative",
  /* Under 160 characters for the same reason. */
  description:
    "Open source email API you run yourself. Resend-compatible REST and SMTP, React templates and webhooks on Next.js, Convex, Better Auth and AWS SES.",
  keywords: [
    "Resend alternative",
    "self-hosted email API",
    "open source transactional email",
    "AWS SES",
    "Docker Compose",
    "Better Auth",
    "Convex",
    "Next.js",
    "SMTP",
    "React Email",
  ],
  author: { name: "Kamal Panara", url: "https://kamalpanara.com" },
  publisher: "Panara Studios",
  publisherUrl: "https://panarastudios.in",
  xHandle: "@PanaraStudios",
  /* Headline and accent on the OG image, split so the accent can be
     colored. Mirrors HERO.titleA / HERO.titleEm in content/landing.ts. */
  og: {
    titleA: "The self-hosted",
    titleEm: "Resend alternative.",
    /* Two lines on purpose: Satori drops spaces when a single paragraph wraps. */
    sub: [
      "Open source email API you run yourself.",
      "You pay Amazon to send. Nothing to us.",
    ],
    alt: "opensend.cc. The self-hosted Resend alternative. Open source email API with REST, SMTP, React templates and webhooks, on your server.",
  },
}

/* Inner routes: title is the `%s` in the root template (`%s · opensend.cc`).
   `index: false` keeps thin or private pages out of search. */
export const PAGES = {
  waitlist: {
    path: "/waitlist",
    title: "Join the Cloud waitlist",
    description:
      "Get notified when managed opensend.cc Cloud is ready. Self-host today with Docker Compose.",
  },
  sponsors: {
    path: "/sponsors",
    title: "Sponsor opensend.cc",
    description:
      "Buy a sponsor spot on opensend.cc. Your brand on the site. The money keeps the self-hosted Resend alternative free.",
  },
  sponsorThanks: {
    path: "/sponsors/thanks",
    title: "Send your sponsor logo",
    description:
      "Payment received. Upload your company name, website, and logo so it can go up on opensend.cc.",
    index: false,
  },
  docs: {
    path: "/docs",
    title: "Docs",
    description:
      "opensend.cc docs are still being written. They will cover Docker Compose, AWS SES, the Resend-compatible API, Convex and Better Auth.",
    index: false,
  },
  license: {
    path: "/license",
    title: "License",
    description:
      "opensend.cc is Apache-2.0. Use it commercially, modify it, and run it on as many servers as you like.",
  },
  privacy: {
    path: "/privacy",
    title: "Privacy Policy",
    description:
      "What opensend.cc collects on this website, why, and how we handle it. Your self-hosted email data never reaches us.",
  },
  terms: {
    path: "/terms",
    title: "Terms of Service",
    description:
      "Terms for using the opensend.cc website and the open source software. The Apache-2.0 license governs the code.",
  },
} as const
