import {
  COMPANY_URL,
  FAQ,
  GITHUB_URL,
  HOW_IT_WORKS,
  PERSONAL_URL,
  WHAT_YOU_GET,
  X_URL,
  YOUTUBE_URL,
} from "@/content/landing"
import { SITE } from "@/content/site"

const orgId = `${SITE.url}/#organization`
const siteId = `${SITE.url}/#website`
const appId = `${SITE.url}/#app`
const personId = `${SITE.url}/#person`
const faqId = `${SITE.url}/#faq`
const howToId = `${SITE.url}/#howto`

function organization() {
  return {
    "@type": "Organization",
    "@id": orgId,
    name: SITE.name,
    url: SITE.url,
    email: SITE.email,
    logo: `${SITE.url}/apple-icon`,
    image: `${SITE.url}/opengraph-image`,
    description: SITE.description,
    parentOrganization: {
      "@type": "Organization",
      name: SITE.publisher,
      url: SITE.publisherUrl,
    },
    founder: { "@id": personId },
    sameAs: [GITHUB_URL, X_URL, YOUTUBE_URL],
  }
}

function person() {
  return {
    "@type": "Person",
    "@id": personId,
    name: SITE.author.name,
    url: SITE.author.url,
    jobTitle: "Founder",
    worksFor: { "@id": orgId },
    sameAs: ["https://x.com/codewithkamal", PERSONAL_URL, COMPANY_URL],
  }
}

function website() {
  return {
    "@type": "WebSite",
    "@id": siteId,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    inLanguage: "en-US",
    publisher: { "@id": orgId },
  }
}

function softwareApplication() {
  return {
    "@type": "SoftwareApplication",
    "@id": appId,
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux, macOS, Windows",
    downloadUrl: GITHUB_URL,
    installUrl: GITHUB_URL,
    softwareRequirements: "Docker",
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isAccessibleForFree: true,
    image: `${SITE.url}/opengraph-image`,
    author: { "@id": personId },
    publisher: { "@id": orgId },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: WHAT_YOU_GET.features.map((feature) => feature.title),
  }
}

function faqPage() {
  return {
    "@type": "FAQPage",
    "@id": faqId,
    url: `${SITE.url}/#faq`,
    mainEntity: FAQ.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  }
}

function howTo() {
  return {
    "@type": "HowTo",
    "@id": howToId,
    name: `${HOW_IT_WORKS.titleEm} ${HOW_IT_WORKS.titleA}`,
    description:
      "Deploy opensend.cc with Docker Compose, connect AWS SES, and send your first email.",
    url: `${SITE.url}/#how-it-works`,
    step: HOW_IT_WORKS.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.body,
      url: `${SITE.url}/#how-it-works`,
    })),
  }
}

export function siteJsonLd() {
  return {
    "@context": "https://schema.org" as const,
    "@graph": [organization(), person(), website()],
  }
}

export function homeJsonLd() {
  return {
    "@context": "https://schema.org" as const,
    "@graph": [softwareApplication(), faqPage(), howTo()],
  }
}
