import type { Metadata } from "next"

import { LegalPage, LegalSection } from "@/components/marketing/legal-page"
import { PAGES } from "@/content/site"
import { pageMetadata } from "@/lib/seo"

export const metadata: Metadata = pageMetadata(PAGES.privacy)

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 18, 2026">
      <LegalSection title="The short version">
        <p>
          opensend.cc is self-hosted. The email data in your deployment lives on
          your server and never reaches us. That includes your contacts, your
          logs and your messages.
        </p>
      </LegalSection>
      <LegalSection title="What this site collects">
        <p>
          This website uses a self-hosted Umami instance. It collects anonymous
          usage statistics without cookies: pages viewed, referrer, and
          approximate country. It stores no personal identifiers and does not
          track you across sites.
        </p>
        <p>
          If you email us or join the cloud waitlist, we keep your address to
          reply and to tell you when Cloud is ready. If you buy a sponsor spot,
          Stripe processes the payment. We receive the email Stripe collects and
          the company name, website, and logo you send so we can put the logo on
          the site.
        </p>
      </LegalSection>
      <LegalSection title="What we never do">
        <p>
          We do not sell your data, share it with advertisers, or use it to
          train models. We send no marketing email other than replies and
          waitlist updates you asked for.
        </p>
      </LegalSection>
      <LegalSection title="Data retention and deletion">
        <p>
          Email hello@opensend.cc and we will remove your contact details within
          30 days.
        </p>
      </LegalSection>
      <LegalSection title="Contact">
        <p>
          opensend.cc is operated by{" "}
          <a
            href="https://panarastudios.in"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:text-primary-hover"
          >
            Panara Studios
          </a>
          . Send questions about this policy to hello@opensend.cc. You run
          opensend.cc on your own deployment, so the data in it is yours and
          never reaches us.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
